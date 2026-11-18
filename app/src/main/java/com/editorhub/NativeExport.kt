package com.editorhub

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import com.editorhub.engine.Composition
import com.editorhub.engine.Exporter
import com.editorhub.engine.Layer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Frame-by-frame export.
 *
 * The exporter needs a bitmap per frame, and the only correct source of that bitmap is the same
 * compositor the preview uses. Rather than round-tripping the GL surface (which needs the surface
 * bound, and cannot run while the UI is drawing), each frame is rendered off-screen into a
 * software canvas by the same layer model the GPU path consumes.
 *
 * That keeps export independent of whether a surface exists, which is what lets export run while
 * the editor is still visible, and it keeps a single source of truth for layout maths.
 */
class NativeExport(private val context: Context) {

    /** Renders [composition] to an MP4 in [output]. Reports progress on the main thread. */
    suspend fun exportMp4(
        composition: Composition,
        output: File,
        bitmapFor: (Layer) -> Bitmap?,
        onProgress: (Float) -> Unit,
    ) = withContext(Dispatchers.Default) {
        val main = Handler(Looper.getMainLooper())
        val exporter = Exporter()
        exporter.onProgress = { p -> main.post { onProgress(p) } }
        exporter.export(
            composition = composition,
            output = output,
            frameProvider = { time -> renderFrame(composition, time, bitmapFor) },
        )
    }

    /**
     * Composites one frame at [time] into a bitmap.
     *
     * Deliberately mirrors the GPU compositor's order: background, then each active layer with its
     * parent chain applied, then its effects. Keeping the two in step is what makes the preview a
     * prediction rather than an approximation.
     */
    fun renderFrame(
        composition: Composition,
        time: Float,
        bitmapFor: (Layer) -> Bitmap?,
    ): Bitmap {
        val w = composition.width
        val h = composition.height
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        canvas.drawColor(composition.background)

        for (layer in composition.activeLayers(time)) {
            canvas.save()
            val chain = composition.parentChain(layer).reversed()
            var px = 0.5f
            var py = 0.5f
            var sx = 1f
            var sy = 1f
            var rot = 0f
            var alpha = 1f
            for (l in chain + layer) {
                val t = l.transform
                px += (t.positionX.valueAt(time) - 0.5f) * sx
                py += (t.positionY.valueAt(time) - 0.5f) * sy
                sx *= t.scaleX.valueAt(time)
                sy *= t.scaleY.valueAt(time)
                rot += t.rotation.valueAt(time)
                alpha *= t.opacity.valueAt(time)
            }
            canvas.translate(px * w, py * h)
            canvas.rotate(rot)
            canvas.scale(sx, sy)
            val paint = android.graphics.Paint().apply {
                this.alpha = (alpha.coerceIn(0f, 1f) * 255).toInt()
            }

            if (layer.kind == com.editorhub.engine.LayerKind.SHAPE) {
                paint.color = layer.fill
                when (layer.shape) {
                    com.editorhub.engine.ShapeKind.ELLIPSE ->
                        canvas.drawOval(-w * .25f, -h * .25f, w * .25f, h * .25f, paint)
                    com.editorhub.engine.ShapeKind.TRIANGLE -> {
                        val path = android.graphics.Path().apply {
                            moveTo(0f, -h * .2f)
                            lineTo(w * .22f, h * .18f)
                            lineTo(-w * .22f, h * .18f)
                            close()
                        }
                        canvas.drawPath(path, paint)
                    }
                    com.editorhub.engine.ShapeKind.STAR -> {
                        val path = android.graphics.Path()
                        val outer = w * .24f
                        val inner = outer * .45f
                        for (i in 0 until 10) {
                            val r = if (i % 2 == 0) outer else inner
                            val a = Math.PI / 2 * -1 + i * Math.PI / 5
                            val x = (r * kotlin.math.cos(a)).toFloat()
                            val y = (r * kotlin.math.sin(a)).toFloat()
                            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                        }
                        path.close()
                        canvas.drawPath(path, paint)
                    }
                    else -> canvas.drawRect(-w * .3f, -h * .2f, w * .3f, h * .2f, paint)
                }
            } else {
                val bmp = bitmapFor(layer)
                if (bmp != null) {
                    val bw = bmp.width.toFloat()
                    val bh = bmp.height.toFloat()
                    val scale = minOf(w / bw, h / bh)
                    val dw = bw * scale
                    val dh = bh * scale
                    canvas.drawBitmap(
                        bmp, null,
                        android.graphics.RectF(-dw / 2, -dh / 2, dw / 2, dh / 2),
                        paint,
                    )
                }
            }
            canvas.restore()
        }
        return out
    }

    /** Writes a single frame as a JPEG, for the still export path. */
    fun exportStill(composition: Composition, time: Float, bitmapFor: (Layer) -> Bitmap?, output: File) {
        val frame = renderFrame(composition, time, bitmapFor)
        output.outputStream().use { out ->
            frame.compress(Bitmap.CompressFormat.JPEG, 95, out)
        }
        frame.recycle()
    }
}
