const body = document.getElementById('capturedTableBody');
const refreshDataBtn = document.getElementById('refreshDataBtn');
const openDevToolsBtn = document.getElementById('openDevToolsBtn');

async function loadCapturedData() {
  const rows = await window.inventoryApi.listCaptured();
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.key}</td>
      <td>${row.value}</td>
      <td>${row.pageId}</td>
      <td>${row.listenerName}</td>
      <td>${row.updatedAt}</td>
    </tr>
  `).join('');
}

refreshDataBtn.addEventListener('click', () => {
  loadCapturedData();
});

openDevToolsBtn.addEventListener('click', () => {
  console.log('[调试] 请通过应用菜单 -> 调试 -> 开发者模式 打开');
});

loadCapturedData();
