/**
 * ============================================================================
 * 📘 在森林那邊 - 系統技術維護手冊 (Developer Guide)
 * ============================================================================
 *
 * # 專案概觀
 * - **版本：** V2.6 (2026/01/25)
 * - **狀態：** Stable / Production
 * - **核心邏輯：** Allocation on Import (匯入即扣庫存) + Undo Capability (可撤銷)
 *
 * ---
 *
 * ## 1. 檔案結構 (File Structure)
 *
 * ### 📱 Mobile Web App
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`Code.gs`** | API | Web App 入口。實作 `LockService`。新增 `triggerUndoImport` 接口。 |
 * | **`index.html`** | UI | 響應式介面。包含「產生撿貨單(黃)」與「回復上一步(紅)」按鈕。 |
 *
 * ### ⚙️ Backend Logic
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`main.gs`** | Controller | **系統中樞**。負責：<br>1. 呼叫 Parser 解析雙平台資料。<br>2. 執行 `saveToSalesDatabase` (炸開扣庫存)。<br>3. 執行 `saveToPickingList` (合併顯示)。<br>4. **強制執行** `InventoryManager` 更新庫存。<br>5. 實作 `undoLastImport` 復原機制。 |
 * | **`InventoryManager.gs`** | Core | **(V2.6 重構)** 改為 Object 物件寫法。負責讀取生產/銷售紀錄，計算並刷新 `[00_儀表板]`。 |
 * | **`ShopeeTextParser.gs`** | Parser | **(V2.6 優化)** 採用關鍵字定位與寬鬆 Regex，支援英數混合單號解析，防止 Timeout。 |
 * | **`WooCommerceParser.gs`** | Parser | **(V2.6 優化)** 放寬 Quantity 解析標準，支援各種格式的官網表格。 |
 * | **`Archiver.gs`** | Bot | 歷史資料自動封存機器人 (每月執行)。 |
 *
 * ---
 *
 * ## 2. 關鍵流程 (Workflows)
 *
 * ### A. 每日訂單匯入 (Daily Import)
 * 1. **Trigger**: 手機/電腦觸發 `generateDailyPickingList`。
 * 2. **Parse**: 讀取 `[00_數據暫存區]`，同時解析蝦皮與官網資料。
 * 3. **Action 1 (DB)**: 寫入 `[03_銷售數據池]` -> **炸開組合包** (如 A*10 拆成 10 個 A)。
 * 4. **Action 2 (Picking)**: 寫入 `[05_撿貨單]` -> **依單號合併** (如 "3雪 10菜")，並附上物流單號後4碼。
 * 5. **Update**: 強制呼叫 `InventoryManager.refreshDashboard()`。即使解析有部分警告，仍會嘗試更新庫存。
 *
 * ### B. 撤銷匯入 (Undo Import)
 * 1. **Trigger**: 觸發 `undoLastImport`。
 * 2. **Process**: 重新掃描暫存區 -> 找出涉及的 Order IDs。
 * 3. **Delete**: 從 `[03_銷售數據池]` 刪除對應的資料列。
 * 4. **Restore**: 清空 `[05_撿貨單]` 並重算庫存。
 *
 * ---
 *
 * ## 3. Schema 備註
 * - **[04_SKU對照表]**: 必須包含 C 欄 (撿貨簡稱) 與 D/E 欄 (平台關鍵字)。
 * - **[05_撿貨單]**: B 欄格式為 `[數量][簡稱] [單號後4碼] ([物流])`。
 *
 */

function README() {
  // Documentation only.
}