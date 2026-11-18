package com.editorhub.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.editorhub.engine.BlendMode
import com.editorhub.engine.Easing
import com.editorhub.engine.EditorStore
import com.editorhub.engine.Effect
import com.editorhub.engine.EffectKind

/**
 * The inspector: tabs for the transform, the effect stack and the layer's own settings.
 *
 * Every animated property shows a diamond that sets or clears a keyframe at the playhead, which
 * is the interaction every motion editor has and the one people look for first.
 */
@Composable
fun Inspector(store: EditorStore, modifier: Modifier = Modifier) {
    val layer = store.composition.layer(store.selectedLayerId)
    var tab by remember { mutableStateOf(0) }

    Column(modifier.background(Ink.panel).padding(horizontal = 12.dp)) {
        if (layer == null) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                Text("Select a layer", color = Ink.dim, fontSize = 12.sp)
            }
            return@Column
        }

        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            listOf("Motion", "Effects", "Layer").forEachIndexed { index, label ->
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (tab == index) Ink.panelHigh else Ink.panel)
                        .clickable { tab = index }
                        .padding(vertical = 7.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        color = if (tab == index) Ink.accent else Ink.dim,
                        fontSize = 11.sp,
                        fontWeight = if (tab == index) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }

        when (tab) {
            0 -> MotionTab(store, layer.id)
            1 -> EffectsTab(store, layer.id)
            else -> LayerTab(store, layer.id)
        }
    }
}

@Composable
private fun MotionTab(store: EditorStore, layerId: String) {
    val layer = store.composition.layer(layerId) ?: return
    LazyColumn {
        item { SectionLabel("Transform") }
        items(layer.transform.channels()) { (label, channel) ->
            val time = store.playhead - layer.start
            val value = channel.valueAt(time)
            val keyed = channel.keys().any { kotlin.math.abs(it.time - time) < 5e-3f }
            Column {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(label, color = Ink.dim, fontSize = 11.sp)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "%.2f".format(value),
                            color = Ink.text,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        // The keyframe diamond.
                        Box(
                            Modifier
                                .padding(start = 8.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (keyed) Ink.accent else Ink.panelHigh)
                                .clickable {
                                    if (keyed) {
                                        store.removeKeyframe(layerId, label, time)
                                    } else {
                                        store.setKeyframe(
                                            layerId, label, time, value, Easing.EASE_IN_OUT,
                                        )
                                    }
                                }
                                .padding(horizontal = 7.dp, vertical = 3.dp),
                        ) {
                            Text(
                                if (keyed) "◆" else "◇",
                                color = if (keyed) Ink.bg else Ink.dim,
                                fontSize = 9.sp,
                            )
                        }
                    }
                }
                LiveSlider(
                    label = "",
                    value = value,
                    range = layer.transform.rangeOf(label),
                    onValueChange = { newValue ->
                        store.editLayer(layerId) { l ->
                            val ch = l.transform.named(label) ?: return@editLayer l
                            val updated = if (ch.isAnimated) {
                                ch.withKey(time, newValue, Easing.EASE_IN_OUT)
                            } else {
                                com.editorhub.engine.Channel.static(newValue)
                            }
                            l.copy(transform = l.transform.with(label, updated))
                        }
                    },
                )
            }
        }
        item { Spacer(Modifier.height(10.dp)) }
        item { SectionLabel("Timing") }
        item {
            val start = layer.start
            LiveSlider("Start", start, 0f..store.composition.duration, { v ->
                store.editLayer(layerId) { it.copy(start = v) }
            }, suffix = "s")
        }
        item {
            val duration = layer.duration
            LiveSlider("Duration", duration, .1f..store.composition.duration, { v ->
                store.editLayer(layerId) { it.copy(duration = v) }
            }, suffix = "s")
        }
        item {
            // Trim: moving sourceStart without moving the layer is a slip edit.
            LiveSlider("Source start", layer.sourceStart, 0f..60f, { v ->
                store.editLayer(layerId) { it.copy(sourceStart = v) }
            }, suffix = "s")
        }
    }
}

@Composable
private fun EffectsTab(store: EditorStore, layerId: String) {
    val layer = store.composition.layer(layerId) ?: return
    var adding by remember { mutableStateOf(false) }

    LazyColumn {
        item {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("EFFECT STACK", color = Ink.dim, fontSize = 9.5.sp, letterSpacing = 1.sp)
                TextButtonSmall(if (adding) "Done" else "+ Add") { adding = !adding }
            }
        }
        if (adding) {
            items(EffectKind.entries) { kind ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            store.editLayer(layerId) { l ->
                                l.copy(effects = l.effects + Effect(kind = kind))
                            }
                            adding = false
                        }
                        .padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(kind.label, color = Ink.text, fontSize = 12.sp)
                    Text("+", color = Ink.accent, fontSize = 14.sp)
                }
            }
        }
        items(layer.effects) { fx ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(fx.kind.label, color = Ink.text, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (fx.enabled) "on" else "off",
                            color = if (fx.enabled) Ink.accent else Ink.dim,
                            fontSize = 10.sp,
                            modifier = Modifier.clickable {
                                store.editLayer(layerId) { l ->
                                    l.copy(effects = l.effects.map {
                                        if (it.id == fx.id) it.copy(enabled = !it.enabled) else it
                                    })
                                }
                            },
                        )
                        Text("✕", color = Ink.danger, fontSize = 11.sp, modifier = Modifier.clickable {
                            store.editLayer(layerId) { l ->
                                l.copy(effects = l.effects.filterNot { it.id == fx.id })
                            }
                        })
                    }
                }
                LiveSlider(
                    label = "amount",
                    value = fx.amount.valueAt(store.playhead - layer.start),
                    range = 0f..1f,
                    onValueChange = { v ->
                        store.editLayer(layerId) { l ->
                            l.copy(effects = l.effects.map {
                                if (it.id == fx.id) it.copy(amount = com.editorhub.engine.Channel.static(v)) else it
                            })
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun LayerTab(store: EditorStore, layerId: String) {
    val layer = store.composition.layer(layerId) ?: return
    Column {
        SectionLabel("Blend")
        Chips(
            BlendMode.entries.map { it to it.label },
            layer.blend,
        ) { mode ->
            store.editLayer(layerId) { it.copy(blend = mode) }
        }
        Spacer(Modifier.height(10.dp))
        SectionLabel("Layer")
        ToggleRow("Visible", layer.visible) { v ->
            store.editLayer(layerId) { it.copy(visible = v) }
        }
        ToggleRow("Locked", layer.locked) { v ->
            store.editLayer(layerId) { it.copy(locked = v) }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButtonSmall("Move up") { store.moveLayer(layerId, 1) }
            TextButtonSmall("Move down") { store.moveLayer(layerId, -1) }
            TextButtonSmall("Delete") {
                store.deleteLayer(layerId)
                store.selectedLayerId = null
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}
