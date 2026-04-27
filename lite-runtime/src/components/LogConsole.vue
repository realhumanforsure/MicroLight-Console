<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LogEvent, ServiceCandidate } from '../types'

const props = defineProps<{
  service: ServiceCandidate | null
  logs: LogEvent[]
}>()

const emit = defineEmits<{
  clear: []
}>()

const renderedLines = computed(() => props.logs.slice(-1000))
const autoFollow = ref(true)
const consoleRef = ref<HTMLDivElement | null>(null)

type RenderedLevel = 'plain' | 'info' | 'warn' | 'error' | 'debug'

function detectLevel(line: string, source: LogEvent['source']): RenderedLevel {
  if (source === 'stderr') {
    return 'error'
  }

  if (/\bERROR\b/u.test(line) || /\bException\b/u.test(line)) {
    return 'error'
  }

  if (/\bWARN\b/u.test(line)) {
    return 'warn'
  }

  if (/\bDEBUG\b/u.test(line) || /\bTRACE\b/u.test(line)) {
    return 'debug'
  }

  if (/\bINFO\b/u.test(line) || source === 'system') {
    return 'info'
  }

  return 'plain'
}

function loggerName(line: string) {
  const matched = line.match(/\b([a-z]\.[\w.]+)\s+-/u)
  return matched?.[1] ?? ''
}

watch(
  renderedLines,
  async () => {
    if (!autoFollow.value) {
      return
    }

    await nextTick()
    const element = consoleRef.value
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  },
  { flush: 'post' }
)
</script>

<template>
  <section class="panel console-panel">
    <div class="panel__header">
      <h2>实时日志</h2>
      <div class="console-toolbar">
        <label class="checkbox-row checkbox-row--quiet">
          <input v-model="autoFollow" type="checkbox" />
          <span>自动跟随</span>
        </label>
        <button class="secondary-button secondary-button--compact" type="button" :disabled="renderedLines.length === 0" @click="emit('clear')">
          清空界面日志
        </button>
        <span class="pill">{{ renderedLines.length }}</span>
      </div>
    </div>

    <div v-if="!service" class="empty-state">
      选择服务后，在这里查看构建输出和运行日志
    </div>

    <div v-else-if="renderedLines.length === 0" class="empty-state">
      等待 {{ service.artifactId }} 输出日志
    </div>

    <div v-else ref="consoleRef" class="console">
      <div
        v-for="entry in renderedLines"
        :key="`${entry.timestamp}-${entry.source}-${entry.line}`"
        class="console__line"
        :class="[`console__line--${entry.source}`, `console__line--${detectLevel(entry.line, entry.source)}`]"
      >
        <span class="console__time">{{ entry.timestamp.slice(11, 19) }}</span>
        <span class="console__source">{{ entry.source === 'system' ? 'sys' : entry.source }}</span>
        <div class="console__payload">
          <span v-if="/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/u.test(entry.line)" class="console__level">
            {{ entry.line.match(/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/u)?.[0] }}
          </span>
          <span v-if="loggerName(entry.line)" class="console__logger">{{ loggerName(entry.line) }}</span>
          <span class="console__text">{{ entry.line }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
