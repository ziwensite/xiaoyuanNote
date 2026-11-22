<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';

// v5.0 — "insert query block" wizard. Triggered by the command palette
// (`xiaoyuan-note:new-query-block`), asks for a title / columns, then emits a
// ready-to-edit ```query fence that Editor.vue drops at the caret. Row count is
// decided by the query result, so it is NOT asked here. The block is then tuned
// visually (toolbar / header menu) in live-edit mode.
const open = ref(false);
const title = ref('');

function onRequest() {
  open.value = true;
}
onMounted(() => window.addEventListener('xiaoyuan-note:new-query-block', onRequest as EventListener));
onBeforeUnmount(() => window.removeEventListener('xiaoyuan-note:new-query-block', onRequest as EventListener));

function confirm() {
  const titleLine = title.value.trim() ? `# ${title.value.trim()}\n` : '';
  // Start as a BLANK block: `columns: []` (no preset columns, no data). The user
  // adds columns visually via the toolbar / header menu in live-edit mode.
  const body = `${titleLine}from: notes\ncolumns: []\n`;
  const fence = '```query\n' + body + '```';
  window.dispatchEvent(new CustomEvent('xiaoyuan-note:insert-query-block', { detail: { fence } }));
  open.value = false;
  title.value = '';
}
function cancel() {
  open.value = false;
}
</script>

<template>
  <div v-if="open" class="qb-create-backdrop" @click.self="cancel">
    <div class="qb-create">
      <h3>新建查询表格</h3>
      <label>标题（可选）
        <input v-model="title" placeholder="例如：本周任务" @keyup.enter="confirm" />
      </label>
      <p class="qb-create-hint">
        新建为空白表格（无预设列、无数据）。插入后在 live 编辑模式用工具栏“＋列”或悬停表头的 ＋ 添加列。
      </p>
      <div class="qb-create-actions">
        <button type="button" @click="cancel">取消</button>
        <button type="button" class="primary" @click="confirm">插入</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qb-create-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
}
.qb-create {
  background: var(--bg, #fff);
  color: var(--text, #222);
  border: 1px solid var(--border, #ccc);
  border-radius: 10px;
  padding: 18px 20px;
  width: 320px;
}
.qb-create h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.qb-create label {
  display: block;
  margin: 8px 0;
  font-size: 13px;
}
.qb-create input {
  width: 100%;
  margin-top: 4px;
  padding: 5px 7px;
  border: 1px solid var(--border, #ccc);
  border-radius: 5px;
  background: var(--bg, #fff);
  color: var(--text, #222);
}
.qb-create-hint {
  font-size: 11px;
  color: var(--text-muted, #888);
  margin: 10px 0;
}
.qb-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.qb-create-actions button {
  padding: 5px 14px;
  border: 1px solid var(--border, #ccc);
  border-radius: 5px;
  background: var(--bg, #fff);
  color: var(--text, #222);
  cursor: pointer;
}
.qb-create-actions .primary {
  background: var(--accent, #3b82f6);
  color: #fff;
  border-color: var(--accent, #3b82f6);
}
</style>
