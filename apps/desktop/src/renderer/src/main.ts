import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderBootstrapError(title: string, error: unknown) {
  const root = document.querySelector<HTMLDivElement>('#app')

  if (!root) {
    return
  }

  const message =
    error instanceof Error
      ? [error.message, error.stack].filter(Boolean).join('\n\n')
      : typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2)

  root.innerHTML = `
    <main style="min-height:100vh;padding:24px;background:linear-gradient(135deg,#162448 0%,#0d1528 52%,#08111f 100%);color:#e9f1ff;font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
      <section style="max-width:960px;margin:0 auto;padding:24px;border-radius:18px;border:1px solid rgba(255,128,128,0.28);background:rgba(19,28,47,0.92);box-shadow:0 18px 42px rgba(0,0,0,0.26);">
        <h1 style="margin:0 0 12px;font-size:28px;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 18px;color:#9db1cf;line-height:1.7;">应用渲染阶段发生异常，已阻止静默黑屏。请把下面错误信息反馈给开发处理。</p>
        <pre style="margin:0;padding:16px;border-radius:14px;background:#08111f;color:#ffd5d5;white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:13px;overflow:auto;">${escapeHtml(message || 'Unknown renderer error')}</pre>
      </section>
    </main>
  `
}

window.addEventListener('error', (event) => {
  renderBootstrapError('MicroLight Console 渲染异常', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  renderBootstrapError('MicroLight Console 未处理 Promise 异常', event.reason)
})

const app = createApp(App)

app.config.errorHandler = (error) => {
  renderBootstrapError('MicroLight Console 组件异常', error)
}

try {
  app.mount('#app')
} catch (error) {
  renderBootstrapError('MicroLight Console 启动失败', error)
}

