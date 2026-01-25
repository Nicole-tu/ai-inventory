/**
 * InventoryManager.gs
 * 負責核心庫存計算與儀表板渲染
 * 
 * 功能:
 * 1. 讀取生產與銷售紀錄，計算當前庫存 (生產 - 銷售)。
 * 2. 應用生命週期規則 (Soft_Delete/EOL 強制歸零)。
 * 3. 渲染 [00_儀表板] 並套用視覺化格式。
 */

const INV_CONFIG = {
  SHEET_NAMES: {
    DASHBOARD: '[00_儀表板]',
    PRODUCTION: '[02_生產紀錄]',
    SALES: '[03_銷售數據池]',
    SKU_MAP: '[04_SKU對照表]'
  },
  STATUS: {
    ACTIVE: 'Active',
    SOFT_DELETE: 'Soft_Delete',
    EOL: 'EOL'
  },
  LOW_STOCK_THRESHOLD: 5
};

/**
 * 主函式：重新計算並刷新儀表板
 */
function refreshDashboard() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  Logger.log("=== 開始計算庫存 ===");

  // --- Step 1: 讀取並彙整數據 (Data Aggregation) ---
  
  // 1.1 讀取 SKU 對照表 (作為 Base)
  const skuMap = _loadSkuMap(ss); // Map<sku, {name, status, ...}>
  
  // 1.2 彙整生產數據
  const productionMap = _aggregateSheetData(ss, INV_CONFIG.SHEET_NAMES.PRODUCTION, 1, 2); // SKU=Col B(idx 1), Qty=Col C(idx 2)

  // 1.3 彙整銷售數據
  const salesMap = _aggregateSheetData(ss, INV_CONFIG.SHEET_NAMES.SALES, 3, 4); // SKU=Col D(idx 3), Qty=Col E(idx 4)

  const dashboardRows = [];
  const formatRules = []; // 用於記錄條件格式 (Row Index)

  // --- Step 2: 計算邏輯 (Calculation) ---
  for (const [sku, info] of skuMap) {
    const prodQty = productionMap.get(sku) || 0;
    const salesQty = salesMap.get(sku) || 0;
    
    let currentStock = prodQty - salesQty;
    
    // Lifecycle Rule: 若非 Active，強制歸零 (僅顯示用，不修改原始數據)
    if (info.status === INV_CONFIG.STATUS.SOFT_DELETE || info.status === INV_CONFIG.STATUS.EOL) {
      currentStock = 0;
    }
    
    // Health Check Logic
    let healthStatus = "✅ 正常";
    if (info.status !== INV_CONFIG.STATUS.ACTIVE) {
      healthStatus = "❌ 已下架";
    } else if (currentStock <= INV_CONFIG.LOW_STOCK_THRESHOLD) {
      healthStatus = "⚠️ 需補貨";
    }

    dashboardRows.push([
      info.name,
      sku,
      currentStock,
      info.status,
      healthStatus
    ]);
  }

  // --- Step 3: 更新儀表板 (Rendering) ---
  const dashSheet = ss.getSheetByName(INV_CONFIG.SHEET_NAMES.DASHBOARD);
  if (!dashSheet) throw new Error("找不到儀表板");

  // 3.1 清空舊資料 (保留第一列 Header)
  const lastRow = dashSheet.getLastRow();
  if (lastRow > 1) {
    dashSheet.getRange(2, 1, lastRow - 1, 5).clearContent().clearFormat();
  }

  // 3.2 寫入新資料
  if (dashboardRows.length > 0) {
    dashSheet.getRange(2, 1, dashboardRows.length, 5).setValues(dashboardRows);
    
    // 3.3 格式美化 (Conditional Formatting)
    // 雖然可以用 Sheet API 的 ConditionalFormatRule，但用 Script 直接遍歷設定背景色在某些場景更直觀
    // 這裡我們針對每一列進行簡單的顏色標記 (讀取 rows 資料判斷)
    
    const range = dashSheet.getRange(2, 1, dashboardRows.length, 5);
    const backgrounds = [];
    const fontColors = [];
    
    for (let i = 0; i < dashboardRows.length; i++) {
      const rowData = dashboardRows[i];
      const stock = rowData[2];
      const status = rowData[3];
      
      let bg = '#FFFFFF'; // Default White
      let font = '#000000'; // Default Black
      
      if (status !== INV_CONFIG.STATUS.ACTIVE) {
        font = '#999999'; // Grey Text for Inactive
        bg = '#F3F3F3'; // Light Grey BG
      } else if (stock <= INV_CONFIG.LOW_STOCK_THRESHOLD) {
        bg = '#F4C7C3'; // Light Red for Low Stock
      }
      
      // 填滿一整列 (5 cells)
      backgrounds.push([bg, bg, bg, bg, bg]);
      fontColors.push([font, font, font, font, font]);
    }
    
    range.setBackgrounds(backgrounds);
    range.setFontColors(fontColors);
    
    // 設定對齊
    range.setHorizontalAlignment('center');
    dashSheet.getRange(2, 1, dashboardRows.length, 1).setHorizontalAlignment('left'); // 名稱靠左
  }

  // 更新時間戳記 或 Log
  const msg = `庫存儀表板已更新 (${new Date().toLocaleTimeString()})`;
  Logger.log(msg);
  if (ui) ss.toast(msg);
}

// --- Helper Functions ---

/**
 * 讀取 SKU 對照表
 * @returns {Map<string, {name, status}>}
 */
function _loadSkuMap(ss) {
  const sheet = ss.getSheetByName(INV_CONFIG.SHEET_NAMES.SKU_MAP);
  const lastRow = sheet.getLastRow();
  const map = new Map();
  
  if (lastRow < 2) return map;
  
  // Headers: [內部SKU, 商品名稱, ..., 商品狀態]
  // 假設 "內部SKU" 在 Col A (Idx 0), "商品名稱" 在 Col B (Idx 1), "商品狀態" 在 Col F (Idx 5)
  // 根據 setup.gs: ['內部SKU', '商品名稱', '撿貨簡稱', '識別關鍵字_蝦皮', '識別關鍵字_官網', '商品狀態']
  
  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  
  data.forEach(row => {
    const sku = String(row[0]).trim();
    if (sku) {
      map.set(sku, {
        name: row[1],
        status: row[5] || INV_CONFIG.STATUS.ACTIVE
      });
    }
  });
  
  return map;
}

/**
 * 彙整指定 Sheet 的數量
 * @param {Spreadsheet} ss 
 * @param {string} sheetName 
 * @param {number} skuColIdx (0-based)
 * @param {number} qtyColIdx (0-based)
 * @returns {Map<string, number>}
 */
function _aggregateSheetData(ss, sheetName, skuColIdx, qtyColIdx) {
  const sheet = ss.getSheetByName(sheetName);
  const map = new Map();
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return map;
  
  // 為了效能，讀取整張表
  const maxCols = Math.max(skuColIdx, qtyColIdx) + 1;
  const data = sheet.getRange(2, 1, lastRow - 1, maxCols).getValues();
  
  data.forEach(row => {
    const sku = String(row[skuColIdx]).trim();
    const qty = Number(row[qtyColIdx]);
    
    if (sku && !isNaN(qty)) {
      const current = map.get(sku) || 0;
      map.set(sku, current + qty);
    }
  });
  
  return map;
}
