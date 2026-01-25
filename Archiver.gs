/**
 * Archiver.gs - 歷史資料封存機器人
 * * 功能：
 * 檢查 [03_銷售數據池] 的資料列數。
 * 如果超過設定的閾值 (例如 2000 筆)，就將最舊的資料搬移到 [Backup_Sales] 工作表。
 * 確保主系統永遠保持輕盈快速。
 */

function autoArchiveSalesData() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const sourceSheetName = '[03_銷售數據池]';
  const targetSheetName = '[Backup_Sales]';
  const KEEP_ROWS = 2000; // 主表只保留最近 2000 筆 (可自行調整)
  
  const sourceSheet = ss.getSheetByName(sourceSheetName);
  if (!sourceSheet) return;

  const lastRow = sourceSheet.getLastRow();
  // 扣掉標題列 (1列)
  const dataRows = lastRow - 1;

  // 1. 檢查是否需要封存
  if (dataRows <= KEEP_ROWS) {
    console.log(`目前資料 ${dataRows} 筆，未達封存標準 (${KEEP_ROWS} 筆)，略過。`);
    return;
  }

  // 2. 計算要搬移幾筆 (Oldest N rows)
  const rowsToMove = dataRows - KEEP_ROWS;
  console.log(`準備封存 ${rowsToMove} 筆舊資料...`);

  // 3. 檢查或建立備份表
  let targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetSheetName);
    // 複製標題列
    const header = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    targetSheet.appendRow(header[0]);
    console.log("已建立新的備份工作表 [Backup_Sales]");
  }

  // 4. 搬移資料 (Copy & Delete)
  // 鎖定舊資料範圍：從第 2 列開始，搬移 rowsToMove 筆
  const rangeToMove = sourceSheet.getRange(2, 1, rowsToMove, sourceSheet.getLastColumn());
  const values = rangeToMove.getValues();

  // 寫入備份表
  const targetLastRow = targetSheet.getLastRow();
  targetSheet.getRange(targetLastRow + 1, 1, rowsToMove, sourceSheet.getLastColumn()).setValues(values);

  // 從主表刪除
  sourceSheet.deleteRows(2, rowsToMove);

  console.log(`✅ 封存完成！已將 ${rowsToMove} 筆資料移至 [Backup_Sales]。`);
}