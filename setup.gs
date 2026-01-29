/**
 * setup.gs - 系統初始化與觸發器設定 (V3.1)
 * * 用途：
 * 快速建立或修復系統所需的 7+1 張核心工作表。
 * 設定自動化排程 (每週補貨報告)。
 */

function initProject() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  
  // 定義所有工作表及其表頭結構
  const sheets = [
    {
      name: "[00_儀表板]",
      headers: ["商品名稱", "內部SKU", "當前庫存", "狀態", "建議動作"]
    },
    {
      name: "[00_數據暫存區]",
      headers: ["【蝦皮 Shopee】原始資料貼上處", "", "【官網 WooCommerce】原始資料貼上處 (C欄開始)"]
    },
    {
      name: "[01_BOM設定]", // 未來擴充預留，或改名為 [06_配方表]
      headers: ["成品SKU", "原料SKU", "消耗數量", "備註"]
    },
    {
      name: "[02_生產紀錄]",
      headers: ["日期", "生產SKU", "數量", "備註"]
    },
    {
      name: "[03_銷售數據池]",
      headers: ["日期", "平台", "訂單編號", "商品SKU", "數量", "原始規格字串"]
    },
    {
      name: "[04_SKU對照表]",
      headers: [
        "內部SKU",          // A
        "商品名稱",          // B
        "撿貨簡稱",          // C
        "識別關鍵字_蝦皮",    // D
        "識別關鍵字_官網",    // E
        "商品狀態",          // F (Active/Soft_Delete)
        "分類",             // G (商品/原料/包材/組合)
        "安全庫存"           // H (整數)
      ]
    },
    {
      name: "[05_撿貨單]",
      headers: ["日期", "撿貨內容", "訂單編號", "物流方式", "平台"]
    },
    {
      name: "[Backup_Sales]",
      headers: ["日期", "平台", "訂單編號", "商品SKU", "數量", "原始規格字串"]
    }
  ];

  // 執行建立迴圈
  sheets.forEach(sheetDef => {
    let sheet = ss.getSheetByName(sheetDef.name);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetDef.name);
      sheet.getRange(1, 1, 1, sheetDef.headers.length).setValues([sheetDef.headers]);
      sheet.setFrozenRows(1);
      console.log(`✅ 已建立工作表: ${sheetDef.name}`);
    } else {
      console.log(`ℹ️ 工作表已存在: ${sheetDef.name}`);
    }
  });
  console.log("🎉 系統初始化檢查完成！");
}

/**
 * 設定自動化排程 (Triggers)
 * 請手動執行一次此函式
 */
function createTriggers() {
  // 1. 先清除所有舊的觸發器，避免重複
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  console.log("已清除舊的觸發器。");

  // 2. 設定【每週補貨報告】
  // 時間：每週一 早上 09:00
  ScriptApp.newTrigger('sendWeeklyRestockReport')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  console.log("✅ 已設定：每週補貨報告 (週一 09:00)");

  // 3. 設定【每日暫存區清理】
  // 時間：每日凌晨 04:00
  ScriptApp.newTrigger('clearStagingArea')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  console.log("✅ 已設定：每日暫存區清理 (每日 04:00)");
}