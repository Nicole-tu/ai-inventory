# 專案背景 (Project Context)
本專案為「在森林那邊 - 輕量級電商庫存管理系統 (ERP V2.6)」，基於 Google Sheets 與 Google Apps Script (GAS) 開發。

## 1. 目前版本狀態：V2.6 (Stable Production)
本版本已解決最核心的「庫存準確性」與「操作容錯率」問題。

### ✅ 已完成功能 (Features)
- **雙平台整合**: 支援蝦皮 (Shopee) 與官網 (WooCommerce) 訂單解析。
- **強韌解析器 (Robust Parser)**: 
  - 蝦皮：改用關鍵字定位，解決網頁格式跑版問題；支援含英文字母的物流單號。
  - 官網：放寬解析標準，防止因空白或格式微差導致漏單。
- **庫存連動 (Allocation on Import)**: 
  - 匯入訂單時，系統自動將組合包 (Bundle) 炸開為單品 (Item) 並寫入資料庫，即時扣除庫存。
  - 強制觸發庫存重算，防止流程中斷導致數據不同步。
- **容錯機制 (Undo)**: 支援「回復上一步」，可自動刪除誤匯入的銷售紀錄並回補庫存。
- **優化 UI**: 
  - 響應式按鈕設計 (手機版大按鈕，電腦版適中)。
  - 庫存盤點採用 Optimistic UI (即時更新數字)，提升操作流暢度。

### 🛠️ 技術架構
- **InventoryManager**: 採用物件化設計 (Singleton Object)，提供穩定的庫存計算 API。
- **Main Controller**: `main.gs` 採用 Force Update 策略，確保錯誤發生時仍嘗試更新庫存。
- **LockService**: 全寫入操作皆受並發鎖保護。

## 2. 未來規劃 (Roadmap V3.0)
下階段將專注於「自動化」與「多平台回寫」。

- **[P1] 多平台庫存同步**: 
  - 開發「庫存更新檔生成器」，一鍵產出蝦皮/官網所需的 CSV 格式，供批次上傳更新。
- **[P2] BOM (配方表) 自動化**: 
  - 建立 `[01_BOM設定]`，實現「賣出 1 個 A，扣除 0.5kg 原料 + 1 個瓶子」的進階扣料邏輯。
- **[P3] Line Notify 通知**: 
  - 每日定時發送庫存缺貨警報與業績摘要。

## 3. 指令規範 (Instruction for AI)
- 修改程式碼時，務必保持 `InventoryManager` 的物件結構。
- 涉及庫存寫入的操作，必須保留 `LockService`。
- 新增功能時，請優先考慮「無頭模式 (Headless)」支援，確保手機 Web App 可呼叫。