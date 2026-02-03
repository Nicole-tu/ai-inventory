/**
 * InventoryManager.gs (V3.1)
 * 功能：庫存計算核心 + 超賣/低庫存偵測
 */
var InventoryManager = {
  CONFIG: {
    SHEET_NAMES: { DASHBOARD:'[00_儀表板]', PRODUCTION:'[02_生產紀錄]', SALES:'[03_銷售數據池]', SKU_MAP:'[04_SKU對照表]' },
    STATUS: { ACTIVE:'Active', SOFT_DELETE:'Soft_Delete', EOL:'EOL' },
    LOW_STOCK_THRESHOLD: 5
  },

  refreshDashboard: function() {
    const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    console.log("=== 計算庫存 v3.1 ===");
    const skuMap = this._loadSkuMap(ss);
    const productionMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.PRODUCTION, 1, 2);
    const salesMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.SALES, 3, 4);
    const dashboardRows = [];
    
    for (const [sku, info] of skuMap) {
      const prodQty = productionMap.get(sku) || 0;
      const salesQty = salesMap.get(sku) || 0;
      let currentStock = prodQty - salesQty;
      if (info.status === this.CONFIG.STATUS.SOFT_DELETE || info.status === this.CONFIG.STATUS.EOL) currentStock = 0;
      
      let healthStatus = "✅ 正常";
      if (info.status !== this.CONFIG.STATUS.ACTIVE) healthStatus = "❌ 已下架";
      else if (currentStock < 0) healthStatus = "🔥 超賣警示";
      else if (currentStock <= this.CONFIG.LOW_STOCK_THRESHOLD) healthStatus = "⚠️ 需補貨";

      dashboardRows.push([info.name, sku, currentStock, info.status, healthStatus]);
    }

    const dashSheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.DASHBOARD);
    if (dashSheet) {
      const lastRow = dashSheet.getLastRow();
      if (lastRow > 1) dashSheet.getRange(2, 1, lastRow - 1, 5).clearContent().clearFormat();
      if (dashboardRows.length > 0) {
        dashSheet.getRange(2, 1, dashboardRows.length, 5).setValues(dashboardRows);
        dashSheet.getRange(2, 1, dashboardRows.length, 5).setHorizontalAlignment('center');
        dashSheet.getRange(2, 1, dashboardRows.length, 1).setHorizontalAlignment('left');
      }
    }
    return ""; 
  },

  // 1. 抓超賣 (<0)
  checkOversoldItems: function() {
    return this._checkItems((stock, safety) => stock < 0);
  },

  // 2. 抓低庫存 (0 <= stock <= safety)
  checkLowStockItems: function() {
    return this._checkItems((stock, safety) => stock >= 0 && stock <= safety);
  },

  // 共用檢查邏輯(已修正：排除組合商品)
  _checkItems: function(predicate) {
    const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    const sheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.DASHBOARD);
    const skuSheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.SKU_MAP); 
    if (!sheet || !skuSheet) return [];
    
    // 讀取安全庫存設定
    const skuData = skuSheet.getRange(2, 1, skuSheet.getLastRow()-1, 8).getValues();
    const safetyMap = {};
    skuData.forEach(r => safetyMap[r[0]] = (r[7]===""||r[7]==null)?5:parseInt(r[7]));

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    const result = [];
    
    data.forEach(row => {
      // 排除已下架
      if (row[3] === this.CONFIG.STATUS.ACTIVE) {
        const name = row[0];
        const sku = row[1];
        const stock = parseInt(row[2]);
        const safety = safetyMap[sku] || 5;
        
        if (predicate(stock, safety)) {
          result.push({ name: name, stock: stock });
        }
      }
    });
    return result;
  },

  getDailyReportText: function() {
    const oversold = this.checkOversoldItems();
    const lowStock = this.checkLowStockItems();
    
    if (oversold.length === 0 && lowStock.length === 0) return null;
    
    let report = "";
    if (oversold.length > 0) report += `🔥 【嚴重超賣】 ${oversold.length} 款 (請處理)：\n${oversold.map(i=>`${i.name} (${i.stock})`).join('\n')}\n\n`;
    if (lowStock.length > 0) report += `⚠️ 【低庫存預警】 ${lowStock.length} 款 (請叫貨)：\n${lowStock.map(i=>`${i.name} (${i.stock})`).join('\n')}`;
    return report;
  },

  _loadSkuMap: function(ss) {
    const sheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.SKU_MAP);
    const lastRow = sheet.getLastRow(); const map = new Map();
    if (lastRow < 2) return map;
    const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    data.forEach(row => { const sku = this._cleanSku(row[0]); if (sku) map.set(sku, { name: row[1], status: row[5] || this.CONFIG.STATUS.ACTIVE }); });
    return map;
  },
  _aggregateSheetData: function(ss, sheetName, skuColIdx, qtyColIdx) {
    const sheet = ss.getSheetByName(sheetName); const map = new Map(); const lastRow = sheet.getLastRow();
    if (lastRow < 2) return map;
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max(skuColIdx, qtyColIdx) + 1).getValues();
    data.forEach(row => { const sku = this._cleanSku(row[skuColIdx]); const qty = Number(row[qtyColIdx]); if (sku && !isNaN(qty)) map.set(sku, (map.get(sku) || 0) + qty); });
    return map;
  },
  _cleanSku: function(rawSku) { if (!rawSku) return ""; return String(rawSku).trim().replace(/[\u200B-\u200D\uFEFF]/g, ''); }
};