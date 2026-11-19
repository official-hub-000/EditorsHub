package com.editorhub;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;

import ru.wowa.jump3r.mp3.BitStream;
import ru.wowa.jump3r.mp3.GainAnalysis;
import ru.wowa.jump3r.mp3.ID3Tag;
import ru.wowa.jump3r.mp3.Lame;
import ru.wowa.jump3r.mp3.LameGlobalFlags;
import ru.wowa.jump3r.mp3.MPEGMode;
import ru.wowa.jump3r.mp3.Presets;
import ru.wowa.jump3r.mp3.Quantize;
import ru.wowa.jump3r.mp3.QuantizePVT;
import ru.wowa.jump3r.mp3.Reservoir;
import ru.wowa.jump3r.mp3.Takehiro;
import ru.wowa.jump3r.mp3.VBRTag;
import ru.wowa.jump3r.mp3.Version;
import ru.wowa.jump3r.mp3.VbrMode;
import ru.wowa.jump3r.mpg.Common;
import ru.wowa.jump3r.mpg.Interface;
import ru.wowa.jump3r.mpg.MPGLib;

/**
 * Real MP3 encoding on the device.
 *
 * The encoder is the LAME core ported to Java (jump3r), compiled into the APK. Nothing is
 * downloaded and no web code is involved: audio is decoded by the platform's MediaExtractor
 * and MediaCodec, handed to LAME as PCM, and LAME writes the MPEG-1 Layer III frames that go
 * straight into the output file.
 *
 * LAME is LGPL-2.1; see THIRD_PARTY_NOTICES.txt. The accompanying sources are in this
 * repository, which is how the relinking requirement is met for statically compiled code.
 */
final class Mp3Encoder {
    private static final String TAG = "Mp3Encoder";
    private static final int MP3_BUFFER = 16384;

    private final Lame lame = buildLame();
    private LameGlobalFlags flags;

    private static Lame buildLame() {
        Version version = new Version();
        GainAnalysis gain = new GainAnalysis();
        VBRTag vbrTag = new VBRTag();
        Takehiro takehiro = new Takehiro();
        Common common = new Common();
        Interface intf = new Interface(common);
        MPGLib mpg = new MPGLib(intf, common);
        BitStream bitStream = new BitStream(gain, mpg, version, vbrTag);
        ID3Tag id3 = new ID3Tag(bitStream, version);
        Presets presets = new Presets();
        QuantizePVT qupvt = new QuantizePVT(takehiro);
        Reservoir reservoir = new Reservoir(bitStream);
        Quantize quantize = new Quantize(bitStream, reservoir, qupvt, takehiro);
        Lame instance = new Lame(gain, bitStream, presets, qupvt, quantize, vbrTag, version, id3, mpg);
        id3.setModules(bitStream, version);
        takehiro.setModules(qupvt);
        vbrTag.setModules(instance, bitStream, version);
        return instance;
    }

    /**
     * Encodes the audio track of source into an MP3 at destination.
     *
     * @param bitrateKbps target bitrate, or the mean bitrate in VBR mode
     * @param vbr         true for variable bitrate
     * @param onProgress  receives a 0..1 fraction; may be null
     */
    File encode(File source, File destination, int bitrateKbps, boolean vbr, Progress onProgress)
            throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        FileOutputStream out = null;
        try {
            extractor.setDataSource(source.getAbsolutePath());
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                String candidateMime = candidate.getString(MediaFormat.KEY_MIME);
                if (candidateMime != null && candidateMime.startsWith("audio/")) {
                    track = i;
                    format = candidate;
                    break;
                }
            }
            if (track < 0 || format == null) {
                throw new IOException("That file has no audio track");
            }
            extractor.selectTrack(track);

            int sampleRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                    ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                    ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;
            long durationUs = format.containsKey(MediaFormat.KEY_DURATION)
                    ? format.getLong(MediaFormat.KEY_DURATION) : 0L;

            initLame(sampleRate, channels, bitrateKbps, vbr);

            String mime = format.getString(MediaFormat.KEY_MIME);
            decoder = MediaCodec.createDecoderByType(mime);
            decoder.configure(format, null, null, 0);
            decoder.start();

            out = new FileOutputStream(destination);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            byte[] mp3Buffer = new byte[MP3_BUFFER];
            long totalSamples = 0;
            long expectedSamples = (durationUs > 0 && sampleRate > 0)
                    ? (durationUs * sampleRate) / 1000000L : 0L;
            long startedAt = System.currentTimeMillis();

            while (!outputDone) {
                if (!inputDone) {
                    int inIndex = decoder.dequeueInputBuffer(10000);
                    if (inIndex >= 0) {
                        ByteBuffer inBuf = decoder.getInputBuffer(inIndex);
                        int size = extractor.readSampleData(inBuf, 0);
                        if (size < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                int outIndex = decoder.dequeueOutputBuffer(info, 10000);
                if (outIndex >= 0) {
                    if (info.size > 0) {
                        ByteBuffer outBuf = decoder.getOutputBuffer(outIndex);
                        outBuf.position(info.offset);
                        outBuf.limit(info.offset + info.size);
                        ShortBuffer pcm = outBuf.order(ByteOrder.nativeOrder()).asShortBuffer();
                        int samples = pcm.remaining() / channels;
                        int written = writePcm(pcm, samples, channels, mp3Buffer);
                        if (written > 0) {
                            out.write(mp3Buffer, 0, written);
                        }
                        totalSamples += samples;
                    }
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                    }
                    decoder.releaseOutputBuffer(outIndex, false);
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat actual = decoder.getOutputFormat();
                    int actualCh = actual.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                            ? actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : channels;
                    if (actualCh != channels) {
                        NativeLog.log("WARN", "decoder produced " + actualCh
                                + " channels, container declared " + channels, TAG, 0);
                        channels = actualCh;
                        initLame(sampleRate, channels, bitrateKbps, vbr);
                    }
                }

                if (onProgress != null) {
                    float fraction = expectedSamples > 0
                            ? (float) totalSamples / expectedSamples
                            : (System.currentTimeMillis() - startedAt) / 30000f;
                    onProgress.onProgress(Math.min(0.95f, fraction));
                }
            }

            int flushed = lame.lame_encode_flush(flags, mp3Buffer, 0, mp3Buffer.length);
            if (flushed > 0) {
                out.write(mp3Buffer, 0, flushed);
            }
            out.flush();
            if (onProgress != null) {
                onProgress.onProgress(1f);
            }
            NativeLog.log("INFO", "encoded " + totalSamples + " samples to "
                    + destination.length() + " bytes at " + bitrateKbps + " kbps", TAG, 0);
            return destination;
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException ignored) {
                    // The bytes are already written; a failing close does not spoil the file.
                }
            }
            if (decoder != null) {
                try {
                    decoder.stop();
                } catch (IllegalStateException ignored) {
                    // Already stopped; release is still required.
                }
                try {
                    decoder.release();
                } catch (IllegalStateException ignored) {
                    // Nothing further to release.
                }
            }
            extractor.release();
        }
    }

    private void initLame(int sampleRate, int channels, int bitrateKbps, boolean vbr)
            throws IOException {
        int mpegRate;
        if (sampleRate > 48000) {
            mpegRate = 48000;
        } else if (sampleRate > 32000) {
            mpegRate = 44100;
        } else if (sampleRate > 24000) {
            mpegRate = 32000;
        } else if (sampleRate > 16000) {
            mpegRate = 24000;
        } else if (sampleRate > 11025) {
            mpegRate = 16000;
        } else if (sampleRate > 8000) {
            mpegRate = 12000;
        } else {
            mpegRate = 8000;
        }

        flags = Lame.lame_init();
        flags.num_channels = Math.max(1, Math.min(2, channels));
        flags.in_samplerate = sampleRate;
        flags.out_samplerate = mpegRate;
        flags.mode = flags.num_channels == 1 ? MPEGMode.MONO : MPEGMode.JOINT_STEREO;
        if (vbr) {
            flags.VBR = VbrMode.vbr_default;
            flags.VBR_q = bitrateToQuality(bitrateKbps);
        }
        flags.brate = bitrateKbps;
        flags.quality = 2;
        ID3Tag.id3tag_init(flags);
        int result = lame.lame_init_params(flags);
        if (result < 0) {
            throw new IOException("This sample rate or channel layout cannot be encoded as MP3 "
                    + "(LAME returned " + result + ")");
        }
        NativeLog.log("INFO", "LAME ready: " + sampleRate + " Hz -> " + mpegRate + " Hz, "
                + flags.num_channels + " ch, " + bitrateKbps + " kbps"
                + (vbr ? " VBR" : " CBR"), TAG, 0);
    }

    private static int bitrateToQuality(int bitrateKbps) {
        if (bitrateKbps >= 256) {
            return 0;
        }
        if (bitrateKbps >= 192) {
            return 2;
        }
        if (bitrateKbps >= 160) {
            return 4;
        }
        if (bitrateKbps >= 128) {
            return 5;
        }
        return 7;
    }

    private int writePcm(ShortBuffer pcm, int samples, int channels, byte[] mp3Buffer) {
        if (samples <= 0) {
            return 0;
        }
        short[] left = new short[samples];
        short[] right = channels > 1 ? new short[samples] : left;
        pcm.get(left, 0, samples);
        if (channels > 1) {
            pcm.get(right, 0, samples);
        }
        return lame.lame_encode_buffer(flags, left, right, samples, mp3Buffer, 0, mp3Buffer.length);
    }

    /** Reports progress as a 0..1 fraction of the audio consumed. */
    interface Progress {
        void onProgress(float fraction);
    }
}
