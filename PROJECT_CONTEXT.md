# 專案背景 (Project Context)
本專案為「在森林那邊 - 輕量級電商庫存管理系統 (ERP V2.8.1)」，基於 Google Sheets 與 Google Apps Script (GAS) 開發。

## 1. 目前版本狀態：V2.8.1 (Golden Stable)
本版本已解決 **庫存準確性 (Data Integrity)**、**解析強韌性 (Robust Parsing)** 與 **操作容錯率 (Fault Tolerance)** 三大核心問題，為目前最穩定的生產版本。

### ✅ 核心功能與技術突破
- **雙平台整合**: 支援蝦皮 (Shopee) 與官網 (WooCommerce) 訂單解析與合併統計。
- **強韌解析器 (ShopeeTextParser V2.7.3)**: 
  - **Masking 技術**: 預先遮蔽訂單編號，防止 `...KX2` 被誤判為數量 `x2`。
  - **Cursor Scanning**: 支援單行多商品解析 (如 `...商品Ax1商品Bx1...`)。
  - **Anti-Sticky**: 解決 `x2NT$560` 文字沾黏問題。
- **庫存守門員 (InventoryManager V2.8.1)**: 
  - **Data Sanitization**: 強制清除 SKU 中的隱形字元 (Zero-width space) 與空白，確保扣庫存 100% 命中。
  - **Oversell Alert**: 偵測到庫存 < 0 時，回傳 `🔥 嚴重警告` 至前端。
  - **Debug Feedback**: 回傳特定商品 (如 `wo_oil_100`) 的算式日誌 (`生產-銷售=庫存`) 供前端查帳。
- **容錯機制 (Undo)**: 支援「回復上一步」，可自動刪除誤匯入的銷售紀錄並回補庫存。
- **極簡化 UI (V2.9)**: 針對高頻訂單 (1大+蝦皮店到店) 隱藏冗餘資訊，提升撿貨效率。

### 🛠️ 技術架構
- **InventoryManager**: Singleton Object 設計，提供 `refreshDashboard()` 與 `checkOversoldItems()` API。
- **Main Controller**: `main.gs` 負責協調 Parser 與 Manager，並將後端日誌 (Logs) 封裝回傳給前端 SweetAlert。
- **LockService**: 全寫入操作皆受並發鎖保護。

## 2. 未來規劃 (Roadmap V3.0)
下階段將專注於「自動化」與「多平台回寫」。

- **[P1] 多平台庫存同步**: 
  - 開發「庫存更新檔生成器」，一鍵產出蝦皮/官網所需的 CSV 格式。
- **[P2] BOM (配方表) 自動化**: 
  - 建立 `[01_BOM設定]`，實現「賣出 1 個 A，扣除 0.5kg 原料」的進階扣料邏輯。
- **[P3] Line Notify 通知**: 
  - 每日定時發送庫存缺貨警報與業績摘要。

## 3. 指令規範 (Instruction for AI)
- 修改程式碼時，**嚴禁** 移除 `_cleanSku` 去汙邏輯與 `Masking` 遮蔽邏輯。
- 保持 `main.gs` 的回傳格式，確保前端能正確顯示 Debug Log。
- 涉及庫存寫入的操作，必須保留 `LockService`。