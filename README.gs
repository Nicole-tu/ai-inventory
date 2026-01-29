/**
 * ============================================================================
 * 📘 在森林那邊 - 系統技術維護手冊 (Developer Guide)
 * ============================================================================
 *
 * # 專案概觀
 * - **版本：** V3.1 (2026/01/29)
 * - **狀態：** Clean Version (Removed Webhook)
 * - **核心價值：** 穩定 (Stable) + 潔淨 (Clean) + 容錯 (Fault Tolerant)
 *
 * ---
 *
 * ## 1. 檔案結構 (File Structure)
 *
 * ### 📱 Mobile Web App
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`Code.gs`** | API | **(V3.1)** Web App 入口。移除 Webhook 邏輯，專注於前端 API 與排程任務。 |
 * | **`index.html`** | UI | 響應式介面。包含「撿貨」、「庫存」、「入庫」三大分頁。 |
 *
 * ### ⚙️ Backend Logic
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`main.gs`** | Controller | 系統中樞。負責協調 Parser、寫入 DB、產生撿貨單與 LINE 通知。 |
 * | **`InventoryManager.gs`** | Core | 庫存運算核心。負責讀取 Sheet 資料、計算庫存水位、產生報表文字。 |
 * | **`ShopeeTextParser.gs`** | Parser | 蝦皮訂單文字解析器 (含 Masking 防誤判機制)。 |
 * | **`WooCommerceParser.gs`** | Parser | 官網訂單解析器 (支援後台表格複製貼上)。 |
 * | **`setup.gs`** | Utils | 初始化與排程設定腳本。 |
 *
 * ---
 *
 * ## 2. V3.1 關鍵變更 (Changelog)
 *
 * ### A. 移除即時 Webhook
 * - 為了避免 WooCommerce 302 Redirect 問題與減少維護成本，移除了 `doPost` 處理訂單的邏輯。
 * - **新流程**：官網訂單改由人工複製後台列表 -> 貼上至 `[00_數據暫存區]` C 欄 -> 一鍵匯入。
 *
 * ### B. 強化排程報告
 * - 新增 `sendWeeklyRestockReport()`：每週一自動檢查低水位。
 * - 新增 `sendDailyMorningReport()`：每日晨報 (可選)。
 *
 * ---
 *
 * ## 3. 未來擴充路徑 (Roadmap)
 * 1. **多平台庫存回寫**：建立蝦皮庫存更新檔匯出功能 (Batch Export)。
 * 2. **BOM 自動扣料**：實作 `[06_配方表]`，入庫成品時自動扣除原料。
 * 3. **材積運算**：依照訂單商品體積推薦紙箱尺寸。
 *
 * ---
 *
 * ## 4. Schema 備註
 * - **[00_數據暫存區]**: A欄=蝦皮(文字流), C欄=官網(表格複製)。
 * - **[04_SKU對照表]**: 核心資料庫，H欄為「安全庫存」設定。
 */

function README() {
  // Documentation only.
}