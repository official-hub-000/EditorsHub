package com.editorhub.nativeed.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged

/**
 * Pinch and two-finger pan without the rotation term.
 *
 * The stock `detectTransformGestures` also reports rotation, which on a timeline means a
 * slightly twisted two-finger pinch reports a zoom of 1.0 and a rotation of 4 degrees, so the
 * zoom appears to do nothing. This reports only the ratio and the pan, which is what a
 * timeline or a canvas zoom wants.
 */
suspend fun PointerInputScope.detectTransformGesturesCompat(
    onZoom: (Float) -> Unit,
    onPan: (Float) -> Unit
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var zoomAccum = 1f
        var panAccum = 0f
        do {
            val event = awaitPointerEvent()
            if (event.changes.size >= 2) {
                val zoom = event.calculateZoom()
                val pan = event.calculatePan()
                if (zoom != 1f) { zoomAccum *= zoom; onZoom(zoomAccum); zoomAccum = 1f }
                if (pan.x != 0f) { panAccum += pan.x; onPan(panAccum); panAccum = 0f }
                event.changes.forEach { if (it.positionChanged()) it.consume() }
            }
        } while (event.changes.any { it.pressed })
    }
}

/** Total pan distance helper, kept here so the call sites stay readable. */
fun Offset.lengthSquared(): Float = x * x + y * y
