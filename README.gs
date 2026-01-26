/**
 * ============================================================================
 * 📘 在森林那邊 - 系統技術維護手冊 (Developer Guide)
 * ============================================================================
 *
 * # 專案概觀
 * - **版本：** V2.8.1 (2026/01/26)
 * - **狀態：** Stable Production (Golden Version)
 * - **核心價值：** 強韌解析 (Robust Parsing) + 數據潔淨 (Sanitization) + 即時反饋 (Instant Feedback)
 *
 * ---
 *
 * ## 1. 檔案結構 (File Structure)
 *
 * ### 📱 Mobile Web App
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`Code.gs`** | API | (V2.5) Web App 入口。實作 `LockService`，提供 `doGet` 與資料讀取接口。 |
 * | **`index.html`** | UI | (V2.9) 響應式介面。包含「身分切換」、「平台訂單統計 Badge」、「紅/黃功能鍵」。 |
 *
 * ### ⚙️ Backend Logic
 * | 檔名 | 類型 | 說明 |
 * | :--- | :--- | :--- |
 * | **`main.gs`** | Controller | **(V2.8.1)** 系統中樞。負責流程整合：<br>1. 呼叫 Parser 解析雙平台。<br>2. 執行 DB 寫入 (炸開組合包)。<br>3. 執行撿貨單寫入 (極簡顯示邏輯)。<br>4. **接收 InventoryManager 回傳的 Debug Log 與超賣警報，並傳回前端顯示。** |
 * | **`InventoryManager.gs`** | Core | **(V2.8.1)** 庫存運算核心。<br>1. **Sanitization**: 強制清除 SKU 隱形字元 (零寬空格)，解決比對失敗問題。<br>2. **Audit**: 針對特定 SKU (如 wo_oil_100) 產生算式日誌。<br>3. **Alert**: 偵測庫存 < 0 的商品。 |
 * | **`ShopeeTextParser.gs`** | Parser | **(V2.7.3)** 強力解析器。<br>1. **Masking**: 遮蔽訂單編號 (避免 KX2 誤判)。<br>2. **Cursor Scan**: 游標掃描法處理單行多商品。<br>3. **Anti-Sticky**: 解決 `x2NT$500` 沾黏問題。 |
 * | **`WooCommerceParser.gs`** | Parser | **(V2.6)** 寬鬆模式。支援各種 Quantity 格式 (x 1, × 1)。 |
 * | **`setup.gs`** | Utils | (V2.3) 初始化腳本。建立標準 7+1 張工作表。 |
 * | **`Archiver.gs`** | Bot | 自動封存機器人 (每月執行)。 |
 *
 * ---
 *
 * ## 2. 關鍵流程與機制 (Key Mechanisms)
 *
 * ### A. 資料潔淨化 (Data Sanitization) [V2.8 New]
 * - 在 `InventoryManager` 讀取 `[02]`, `[03]`, `[04]` 所有 Sheet 時，會經過 `_cleanSku()`。
 * - 功能：移除 `\u200B` (零寬空格) 與前後空白，確保 "SKU " 與 "SKU" 被視為相同。
 *
 * ### B. 雙重解析防護 (Dual-Layer Parsing Protection) [V2.7 New]
 * - **Layer 1 (Masking)**: 先將內文中的 `訂單編號` 替換為 `________`，防止 Regex 誤抓單號末碼為數量。
 * - **Layer 2 (Cleaning)**: 解析出商品字串後，自動切除 `件折`、`NT$`、`商品規格:` 等雜訊。
 *
 * ### C. 超賣與查帳反饋 (Oversell & Audit Feedback) [V2.8 New]
 * - `generateDailyPickingList` 執行後，不僅回傳「成功」，還會附帶：
 * 1. **平台統計**: 官網 vs 蝦皮 筆數。
 * 2. **超賣警報**: 若庫存 < 0，顯示 🔥 紅色警告。
 * 3. **查帳日誌**: 顯示指標商品 (wo_oil_100) 的 `生產 - 銷售 = 庫存` 算式，供管理員驗證。
 *
 * ---
 *
 * ## 3. Schema 備註
 * - **[05_撿貨單]**: V2.9 擴充為 5 欄：`[日期, 撿貨內容, 訂單號, 物流, 平台]`。
 * - **[00_數據暫存區]**: A欄=蝦皮(文字流), C欄=官網(表格)。
 */

function README() {
  // Documentation only.
}