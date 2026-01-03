const COLORS = ['#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#8bc34a','#ff9800','#ff5722','#795548'];
let data = { id: 1, label: 'Mindmap', color: '#4a90d9', children: [] };
let selectedId = 1;
let nextId = 2;
let scale = 1;
let offsetX = 0, offsetY = 0;
let isDragging = false, dragStartX, dragStartY;

// Undo/Redo用の履歴管理
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 50;

function saveState() {
  undoStack.push(JSON.stringify({ data, nextId, selectedId }));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = []; // 新しい操作をしたらRedoスタックをクリア
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify({ data, nextId, selectedId }));
  const state = JSON.parse(undoStack.pop());
  data = state.data;
  nextId = state.nextId;
  selectedId = state.selectedId;
  save();
  render();
  updateEditor();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify({ data, nextId, selectedId }));
  const state = JSON.parse(redoStack.pop());
  data = state.data;
  nextId = state.nextId;
  selectedId = state.selectedId;
  save();
  render();
  updateEditor();
}

function updateEditor() {
  const node = findNode(data, selectedId);
  if (node) {
    document.getElementById('edit-label').value = node.label;
    document.querySelectorAll('.color-option').forEach(el => el.classList.toggle('selected', el.dataset.color === node.color));
    document.getElementById('node-editor').classList.add('active');
  }
}

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function init() {
  const saved = localStorage.getItem('mindmap-data');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      data = parsed.data || data;
      nextId = parsed.nextId || 2;
    } catch(e) {}
  }
  setupColorPicker();
  setupCanvasEvents();
  resize();
  render();
  updateMobileActionBar(); // モバイルアクションバーの初期状態を設定
  window.addEventListener('resize', resize);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setupColorPicker() {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  COLORS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-option';
    div.style.background = c;
    div.dataset.color = c;
    div.addEventListener('click', () => updateNodeColor(c));
    picker.appendChild(div);
  });
}

function setupCanvasEvents() {
  let dragMoved = false;
  
  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragMoved = false;
    dragStartX = e.clientX - offsetX;
    dragStartY = e.clientY - offsetY;
  });
  canvas.addEventListener('mousemove', e => {
    if (isDragging) {
      const dx = e.clientX - offsetX - dragStartX;
      const dy = e.clientY - offsetY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragMoved = true;
      }
      offsetX = e.clientX - dragStartX;
      offsetY = e.clientY - dragStartY;
      render();
    }
  });
  canvas.addEventListener('mouseup', () => isDragging = false);
  canvas.addEventListener('mouseleave', () => isDragging = false);

  // タッチイベント対応（長押し・ダブルタップ対応）
  let longPressTimer = null;
  let lastTapTime = 0;
  let lastTapNode = null;
  const LONG_PRESS_DURATION = 500; // 長押し判定時間（ms）
  const DOUBLE_TAP_DELAY = 300; // ダブルタップ判定時間（ms）

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      dragMoved = false;
      const touch = e.touches[0];
      dragStartX = touch.clientX - offsetX;
      dragStartY = touch.clientY - offsetY;

      // 長押し検出のためのタイマーを設定
      const touchX = touch.clientX;
      const touchY = touch.clientY;
      longPressTimer = setTimeout(() => {
        if (!dragMoved) {
          const rect = canvas.getBoundingClientRect();
          const x = (touchX - rect.left - offsetX - canvas.width/2) / scale;
          const y = (touchY - rect.top - offsetY - canvas.height/2) / scale;
          const node = findNodeAtPosition(data, x, y);
          if (node) {
            // バイブレーションフィードバック（対応端末のみ）
            if (navigator.vibrate) navigator.vibrate(50);
            selectNode(node.id);
            showContextMenu(touchX, touchY, node);
          }
        }
      }, LONG_PRESS_DURATION);
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (isDragging && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - offsetX - dragStartX;
      const dy = touch.clientY - offsetY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragMoved = true;
        // ドラッグ開始したら長押しタイマーをキャンセル
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
      offsetX = touch.clientX - dragStartX;
      offsetY = touch.clientY - dragStartY;
      render();
    }
  }, { passive: true });

  canvas.addEventListener('touchend', e => {
    // 長押しタイマーをキャンセル
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (!dragMoved && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const x = (touch.clientX - rect.left - offsetX - canvas.width/2) / scale;
      const y = (touch.clientY - rect.top - offsetY - canvas.height/2) / scale;
      const node = findNodeAtPosition(data, x, y);

      if (node) {
        const now = Date.now();
        // ダブルタップ検出
        if (lastTapNode && lastTapNode.id === node.id && (now - lastTapTime) < DOUBLE_TAP_DELAY) {
          // ダブルタップで編集開始
          selectNode(node.id);
          showInlineEditor();
          lastTapNode = null;
          lastTapTime = 0;
        } else {
          // シングルタップ
          selectNode(node.id);
          lastTapNode = node;
          lastTapTime = now;
        }
      } else {
        lastTapNode = null;
        lastTapTime = 0;
      }
    }
    isDragging = false;
  });

  canvas.addEventListener('touchcancel', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    isDragging = false;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.max(0.3, Math.min(3, scale * delta));
    render();
  });
  canvas.addEventListener('click', e => {
    if (dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX - canvas.width/2) / scale;
    const y = (e.clientY - rect.top - offsetY - canvas.height/2) / scale;
    const node = findNodeAtPosition(data, x, y);
    if (node) { selectNode(node.id); }
  });
  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX - canvas.width/2) / scale;
    const y = (e.clientY - rect.top - offsetY - canvas.height/2) / scale;
    const node = findNodeAtPosition(data, x, y);
    if (node) { 
      selectNode(node.id); 
      showInlineEditor();
    }
  });
  
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX - canvas.width/2) / scale;
    const y = (e.clientY - rect.top - offsetY - canvas.height/2) / scale;
    const node = findNodeAtPosition(data, x, y);
    if (node) {
      selectNode(node.id);
      showContextMenu(e.clientX, e.clientY, node);
    } else {
      hideContextMenu();
    }
  });
  
  document.addEventListener('click', e => {
    if (!e.target.closest('#context-menu')) {
      hideContextMenu();
    }
  });
  
  // インライン入力欄のイベント設定
  setupInlineEditor();
  
  // キーボードショートカット
  document.addEventListener('keydown', e => {
    const inlineInput = document.getElementById('inline-input');
    const editLabel = document.getElementById('edit-label');
    
    // 入力欄にフォーカスがある場合
    if (document.activeElement === inlineInput || document.activeElement === editLabel) {
      return;
    }
    
    // Ctrl+Z / Cmd+Z でUndo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    
    // Ctrl+Y / Cmd+Shift+Z でRedo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    
    // 特殊キーは無視
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    
    // Enterキーで子ノード追加
    if (e.key === 'Enter') {
      e.preventDefault();
      addChild();
      // 新しいノードの編集を開始
      setTimeout(() => showInlineEditor(), 50);
      return;
    }
    
    // Tabキーで兄弟ノード追加
    if (e.key === 'Tab') {
      e.preventDefault();
      addSibling();
      setTimeout(() => showInlineEditor(), 50);
      return;
    }
    
    // Escapeキーで選択解除
    if (e.key === 'Escape') {
      hideInlineEditor();
      document.getElementById('node-editor').classList.remove('active');
      return;
    }
    
    // F2キーまたはスペースキーで編集開始
    if (e.key === 'F2' || e.key === ' ') {
      e.preventDefault();
      showInlineEditor();
      return;
    }
    
    // Backspaceキーで新規ノードのみ削除
    if (e.key === 'Backspace') {
      e.preventDefault();
      deleteNewNodeOnly();
      return;
    }
    
    // 印字可能な文字の場合、インライン編集を開始
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      showInlineEditor(e.key);
    }
  });
}

function resize() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  render();
}

function findNode(node, id) {
  if (node.id === id) return node;
  for (const child of (node.children || [])) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(node, id, parent = null) {
  if (node.id === id) return parent;
  for (const child of (node.children || [])) {
    const found = findParent(child, id, node);
    if (found) return found;
  }
  return null;
}

function selectNode(id) {
  selectedId = id;
  const node = findNode(data, id);
  if (node) {
    document.getElementById('edit-label').value = node.label;
    document.querySelectorAll('.color-option').forEach(el => el.classList.toggle('selected', el.dataset.color === node.color));
    document.getElementById('node-editor').classList.add('active');
  }
  updateMobileActionBar();
  render();
}

// モバイルアクションバーの状態を更新
function updateMobileActionBar() {
  const isRoot = selectedId === data.id;
  const siblingBtn = document.getElementById('action-add-sibling');
  const deleteBtn = document.getElementById('action-delete');

  if (siblingBtn) siblingBtn.disabled = isRoot;
  if (deleteBtn) deleteBtn.disabled = isRoot;
}

function updateNodeLabel(value) {
  const node = findNode(data, selectedId);
  if (node && node.label !== value) {
    saveState(); // ラベル変更前の状態を保存
    node.label = value;
    save();
    render();
  }
}

function updateNodeColor(color) {
  const node = findNode(data, selectedId);
  if (node && node.color !== color) {
    saveState(); // 色変更前の状態を保存
    node.color = color;
    save();
    render();
  }
  document.querySelectorAll('.color-option').forEach(el => el.classList.toggle('selected', el.dataset.color === color));
}

function addChild() {
  const parent = findNode(data, selectedId);
  if (parent) {
    saveState(); // 子ノード追加前の状態を保存
    if (!parent.children) parent.children = [];
    const newNode = { id: nextId++, label: '新規ノード', color: parent.color, children: [] };
    parent.children.push(newNode);
    save(); render();
    selectNode(newNode.id);
  }
}

function addSibling() {
  if (selectedId === data.id) return;
  const parent = findParent(data, selectedId);
  if (parent) {
    saveState(); // 兄弟ノード追加前の状態を保存
    const newNode = { id: nextId++, label: '新規ノード', color: parent.color, children: [] };
    parent.children.push(newNode);
    save(); render();
    selectNode(newNode.id);
  }
}

function deleteNode() {
  if (selectedId === data.id) return;
  const parent = findParent(data, selectedId);
  if (parent) {
    saveState(); // 削除前の状態を保存
    parent.children = parent.children.filter(c => c.id !== selectedId);
    selectedId = parent.id;
    save(); render();
  }
}

function deleteNewNodeOnly() {
  if (selectedId === data.id) return;
  const node = findNode(data, selectedId);
  if (node && node.label === '新規ノード') {
    deleteNode();
  }
}

function save() {
  localStorage.setItem('mindmap-data', JSON.stringify({ data, nextId }));
}

function exportData() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mindmap.json'; a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  document.getElementById('file-input').click();
}

function sanitizeNode(node) {
  if (typeof node !== 'object' || node === null) return null;
  
  const sanitized = {
    id: typeof node.id === 'number' ? node.id : nextId++,
    label: typeof node.label === 'string' ? node.label.slice(0, 200) : 'ノード',
    color: typeof node.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(node.color) ? node.color : '#4a90d9',
    children: []
  };
  
  if (Array.isArray(node.children)) {
    sanitized.children = node.children.map(c => sanitizeNode(c)).filter(c => c !== null);
  }
  
  return sanitized;
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const sanitized = sanitizeNode(parsed);
      if (!sanitized) throw new Error('Invalid data');
      data = sanitized;
      nextId = Math.max(nextId, getMaxId(data) + 1);
      selectedId = data.id;
      save(); render();
    } catch(err) { alert('JSONの読み込みに失敗しました'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function getMaxId(node) {
  let max = node.id;
  for (const child of (node.children || [])) max = Math.max(max, getMaxId(child));
  return max;
}

function zoomIn() { scale = Math.min(3, scale * 1.2); render(); }
function zoomOut() { scale = Math.max(0.3, scale / 1.2); render(); }
function resetView() { scale = 1; offsetX = 0; offsetY = 0; render(); }

// モバイルサイドバートグル
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuBtn = document.getElementById('mobile-menu-btn');

  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
  menuBtn.classList.toggle('active');
}

function showContextMenu(x, y, node) {
  const menu = document.getElementById('context-menu');
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  
  // ルートノードの場合は一部メニューを無効化
  const isRoot = node.id === data.id;
  document.getElementById('ctx-add-sibling').classList.toggle('disabled', isRoot);
  document.getElementById('ctx-delete').classList.toggle('disabled', isRoot);
  
  // メニュー位置を調整（画面外にはみ出さないように）
  let menuX = x - rect.left;
  let menuY = y - rect.top;
  
  menu.style.left = menuX + 'px';
  menu.style.top = menuY + 'px';
  menu.classList.add('active');
  
  // 画面外にはみ出す場合は調整
  setTimeout(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      menu.style.left = (menuX - menuRect.width) + 'px';
    }
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = (menuY - menuRect.height) + 'px';
    }
  }, 0);
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.remove('active');
}

function contextAddChild() {
  hideContextMenu();
  addChild();
}

function contextAddSibling() {
  hideContextMenu();
  addSibling();
}

function contextEditNode() {
  hideContextMenu();
  showInlineEditor();
}

function contextDeleteNode() {
  hideContextMenu();
  deleteNode();
}

function contextDuplicateNode() {
  hideContextMenu();
  if (selectedId === data.id) return;
  
  const node = findNode(data, selectedId);
  const parent = findParent(data, selectedId);
  if (node && parent) {
    saveState(); // 複製前の状態を保存
    const cloned = JSON.parse(JSON.stringify(node));
    reassignIds(cloned);
    cloned.label = node.label + ' (コピー)';
    parent.children.push(cloned);
    save();
    render();
    selectNode(cloned.id);
  }
}

function reassignIds(node) {
  node.id = nextId++;
  for (const child of (node.children || [])) {
    reassignIds(child);
  }
}

// ========== 日本語入力対応のインライン編集機能 ==========

function setupInlineEditor() {
  const inlineEditor = document.getElementById('inline-editor');
  const inlineInput = document.getElementById('inline-input');
  const modeIndicator = document.getElementById('input-mode-indicator');
  const modeText = document.getElementById('mode-text');
  
  // IME変換開始
  inlineInput.addEventListener('compositionstart', () => {
    modeText.textContent = '変換中...';
  });
  
  // IME変換中（リアルタイムプレビュー）
  inlineInput.addEventListener('compositionupdate', (e) => {
    // 変換中のテキストをリアルタイムでノードに反映（プレビュー）
    updateNodePreview(inlineInput.value);
  });
  
  // IME変換確定
  inlineInput.addEventListener('compositionend', () => {
    modeText.textContent = '編集中';
    // 確定したテキストを反映
    updateNodePreview(inlineInput.value);
  });
  
  // 入力中のリアルタイム更新
  inlineInput.addEventListener('input', (e) => {
    if (!e.isComposing) {
      updateNodePreview(inlineInput.value);
    }
  });
  
  // キーダウンイベント
  inlineInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // IME変換中は無視
    
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmInlineEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      confirmInlineEdit();
      addSibling();
      setTimeout(() => showInlineEditor(), 50);
    }
  });
  
  // フォーカスが外れたら確定
  inlineInput.addEventListener('blur', () => {
    // 少し遅延させて、他の要素へのクリックを処理できるようにする
    setTimeout(() => {
      if (document.getElementById('inline-editor').classList.contains('active')) {
        confirmInlineEdit();
      }
    }, 100);
  });
}

let originalLabel = ''; // 編集前のラベルを保存

function showInlineEditor(initialChar = null) {
  const node = findNode(data, selectedId);
  if (!node) return;
  
  const inlineEditor = document.getElementById('inline-editor');
  const inlineInput = document.getElementById('inline-input');
  const modeIndicator = document.getElementById('input-mode-indicator');
  
  // 編集前のラベルを保存
  originalLabel = node.label;
  
  // 初期文字がある場合は置き換え、なければ現在のラベルを表示
  if (initialChar !== null) {
    inlineInput.value = initialChar;
    node.label = initialChar;
  } else {
    inlineInput.value = node.label;
  }
  
  // ノードの位置に入力欄を配置
  positionInlineEditor(node);
  
  inlineEditor.classList.add('active');
  modeIndicator.classList.add('active');
  
  // フォーカスして全選択（初期文字がない場合）
  inlineInput.focus();
  if (initialChar === null) {
    inlineInput.select();
  } else {
    // カーソルを末尾に
    inlineInput.setSelectionRange(inlineInput.value.length, inlineInput.value.length);
  }
  
  render();
}

function positionInlineEditor(node) {
  const inlineEditor = document.getElementById('inline-editor');
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  
  // ノードのキャンバス上の位置を画面座標に変換
  const nodeWidth = node._width || 60;
  const screenX = canvas.width / 2 + offsetX + (node._x + nodeWidth / 2) * scale;
  const screenY = canvas.height / 2 + offsetY + node._y * scale;
  
  // 入力欄の位置を設定（ノードの下に表示）
  inlineEditor.style.left = Math.max(10, screenX - 100) + 'px';
  inlineEditor.style.top = (screenY + 25) + 'px';
}

function updateNodePreview(value) {
  const node = findNode(data, selectedId);
  if (node) {
    node.label = value;
    document.getElementById('edit-label').value = value;
    render();
  }
}

function confirmInlineEdit() {
  const inlineInput = document.getElementById('inline-input');
  const node = findNode(data, selectedId);
  
  if (node) {
    const newLabel = inlineInput.value.trim() === '' ? (originalLabel || '新規ノード') : inlineInput.value;
    if (newLabel !== originalLabel) {
      // 編集開始時の状態を保存（originalLabelが変更前の値）
      const currentLabel = node.label;
      node.label = originalLabel; // 一時的に元に戻す
      saveState(); // 変更前の状態を保存
      node.label = newLabel; // 新しい値を設定
    }
    document.getElementById('edit-label').value = node.label;
    save();
  }
  
  hideInlineEditor();
  render();
}

function cancelInlineEdit() {
  const node = findNode(data, selectedId);
  if (node) {
    node.label = originalLabel;
    document.getElementById('edit-label').value = originalLabel;
  }
  hideInlineEditor();
  render();
}

function hideInlineEditor() {
  document.getElementById('inline-editor').classList.remove('active');
  document.getElementById('input-mode-indicator').classList.remove('active');
}

function measureTextWidth(text) {
  ctx.font = '12px -apple-system, sans-serif';
  return ctx.measureText(text).width;
}

function getNodeWidth(node) {
  const padding = 24;
  const minWidth = 60;
  const width = measureTextWidth(node.label) + padding;
  return Math.max(minWidth, width);
}

function calculateNodeWidths(node) {
  node._width = getNodeWidth(node);
  for (const child of (node.children || [])) {
    calculateNodeWidths(child);
  }
}

function getMaxWidthAtDepth(node, targetDepth, currentDepth = 0) {
  if (currentDepth === targetDepth) return node._width;
  let maxWidth = 0;
  for (const child of (node.children || [])) {
    maxWidth = Math.max(maxWidth, getMaxWidthAtDepth(child, targetDepth, currentDepth + 1));
  }
  return maxWidth;
}

function getMaxDepth(node, depth = 0) {
  let max = depth;
  for (const child of (node.children || [])) {
    max = Math.max(max, getMaxDepth(child, depth + 1));
  }
  return max;
}

function calculateLayout(node, depth = 0, yOffset = 0, depthOffsets = null) {
  const nodeHeight = 30;
  const horizontalGap = 30;
  const verticalGap = 10;
  
  if (depthOffsets === null) {
    calculateNodeWidths(data);
    const maxDepth = getMaxDepth(data);
    depthOffsets = [0];
    for (let d = 0; d < maxDepth; d++) {
      const maxWidth = getMaxWidthAtDepth(data, d);
      depthOffsets.push(depthOffsets[d] + maxWidth + horizontalGap);
    }
  }
  
  let totalHeight = nodeHeight;
  const childLayouts = [];
  
  if (node.children && node.children.length > 0) {
    let childY = yOffset;
    for (const child of node.children) {
      const childLayout = calculateLayout(child, depth + 1, childY, depthOffsets);
      childLayouts.push(childLayout);
      childY += childLayout.totalHeight + verticalGap;
    }
    totalHeight = Math.max(nodeHeight, childY - yOffset - verticalGap);
  }
  
  const x = depthOffsets[depth];
  const y = yOffset + totalHeight / 2;
  
  node._x = x;
  node._y = y;
  node._totalHeight = totalHeight;
  
  return { node, x, y, totalHeight, children: childLayouts };
}

function findNodeAtPosition(node, x, y) {
  const nodeWidth = node._width || 60;
  const nodeHeight = 26;
  if (x >= node._x - 10 && x <= node._x + nodeWidth + 10 && y >= node._y - nodeHeight/2 && y <= node._y + nodeHeight/2) {
    return node;
  }
  for (const child of (node.children || [])) {
    const found = findNodeAtPosition(child, x, y);
    if (found) return found;
  }
  return null;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
  ctx.scale(scale, scale);
  
  const layout = calculateLayout(data, 0, -getTotalHeight(data) / 2);
  drawConnections(data);
  drawNodes(data);
  
  ctx.restore();
  renderTree();
}

function getTotalHeight(node) {
  if (!node.children || node.children.length === 0) return 30;
  let total = 0;
  for (const child of node.children) total += getTotalHeight(child) + 10;
  return total - 10;
}

function drawConnections(node) {
  if (!node.children) return;
  for (const child of node.children) {
    const nodeWidth = node._width || 60;
    ctx.beginPath();
    ctx.moveTo(node._x + nodeWidth, node._y);
    const cpX = (node._x + nodeWidth + child._x) / 2;
    ctx.bezierCurveTo(cpX, node._y, cpX, child._y, child._x, child._y);
    ctx.strokeStyle = child.color || '#999';
    ctx.lineWidth = 2;
    ctx.stroke();
    drawConnections(child);
  }
}

function drawNodes(node) {
  const isSelected = node.id === selectedId;
  const x = node._x, y = node._y;
  const nodeWidth = node._width || 60;
  const nodeHeight = 26;
  
  ctx.fillStyle = node.color || '#4a90d9';
  ctx.beginPath();
  ctx.roundRect(x, y - nodeHeight/2, nodeWidth, nodeHeight, nodeHeight/2);
  ctx.fill();
  
  if (isSelected) {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  ctx.fillStyle = '#fff';
  ctx.font = '12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(node.label, x + nodeWidth/2, y);
  
  for (const child of (node.children || [])) drawNodes(child);
}

function renderTreeNode(node, isRoot = false) {
  const container = document.createDocumentFragment();
  
  const treeItem = document.createElement('div');
  treeItem.className = 'tree-item' + (node.id === selectedId ? ' selected' : '') + (isRoot ? ' root' : '');
  treeItem.addEventListener('click', () => selectNode(node.id));
  
  const colorDiv = document.createElement('div');
  colorDiv.className = 'node-color';
  colorDiv.style.background = node.color;
  
  const labelSpan = document.createElement('span');
  labelSpan.className = 'node-label';
  labelSpan.textContent = node.label;
  
  treeItem.appendChild(colorDiv);
  treeItem.appendChild(labelSpan);
  container.appendChild(treeItem);
  
  if (node.children && node.children.length > 0) {
    const childContainer = document.createElement('div');
    childContainer.className = 'tree-node';
    node.children.forEach(c => {
      childContainer.appendChild(renderTreeNode(c));
    });
    container.appendChild(childContainer);
  }
  
  return container;
}

function renderTree() {
  const container = document.getElementById('tree-container');
  container.innerHTML = '';
  container.appendChild(renderTreeNode(data, true));
}

init();
