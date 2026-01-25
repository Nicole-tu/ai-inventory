/**
 * WooCommerceParser.gs (V2.6_Relaxed)
 * 修正：放寬 Quantity 的解析規則，避免因網頁格式差異導致抓不到商品。
 */

var WooCommerceParser = {
  
  parseWooData: function(dataValues) {
    var ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    var skuMap = this._getWooSkuMap(ss);
    
    var orders = [];
    
    for (var i = 0; i < dataValues.length; i++) {
      var row = dataValues[i];
      
      // 1. 基礎檢查
      if (!row[1]) continue; 
      var orderIdMatch = String(row[1]).match(/#(\d+)/);
      if (!orderIdMatch) continue;
      var orderId = orderIdMatch[1];
      
      // 2. 狀態檢查
      var status = String(row[4]);
      if (status.includes("已取消") || status.includes("失敗")) continue;

      // 3. 物流資訊
      var shippingInfoRaw = String(row[5]);
      var logistics = "Unknown";
      if (shippingInfoRaw.includes('7-ELEVEN')) logistics = '7-ELEVEN';
      else if (shippingInfoRaw.includes('全家')) logistics = '全家';
      else if (shippingInfoRaw.includes('萊爾富')) logistics = '萊爾富';
      else if (shippingInfoRaw.includes('OK')) logistics = 'OK';
      else if (shippingInfoRaw.includes('黑貓')) logistics = '黑貓';
      
      // 4. 物流單號
      var trackingRaw = String(row[6]);
      var trackingNumber = trackingRaw;

      // 5. 商品解析 (關鍵修正區)
      var productBlob = String(row[2]);
      // 使用更強的分割，過濾掉純空白行
      var lines = productBlob.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 0; });
      
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        
        // 放寬 Regex: 
        // 1. 只要有數字 ( \d+ )
        // 2. 前面可能有 "Quantity:", "×", "x", 或什麼都沒有
        // 測試案例: "Quantity: 1", "× 1", "x1", "Quantity: x1"
        var qtyMatch = line.match(/(?:Quantity:|Quantity|×|x|^)\s*[:×x]?\s*(\d+)\s*$/i);
        
        if (qtyMatch) {
          var rawQty = parseInt(qtyMatch[1], 10);
          
          // 假設商品名稱在上一行
          if (j > 0) {
            var rawName = lines[j-1];
            
            // 排除掉上一行如果是價格或其他雜訊的情況 (簡單判斷: 名稱通常不含 $)
            if (rawName.includes("NT$") || rawName.includes("Subtotal")) {
               if (j > 1) rawName = lines[j-2]; // 再往上找一行
            }

            var mapped = WooCommerceParser._processWooSkuLogic(rawName, skuMap);
            
            orders.push({
              date: new Date(),
              orderId: orderId,
              platform: 'WooCommerce',
              productName: rawName,
              sku: mapped.sku,
              abbr: mapped.abbr,
              qty: rawQty,
              logistics: logistics,
              trackingNumber: trackingNumber,
              raw: rawName
            });
          }
        }
      }
    }
    
    return orders;
  },

  _getWooSkuMap: function(ss) {
    var sheet = ss.getSheetByName('[04_SKU對照表]');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    return data.map(function(row) {
      return {
        internalSku: String(row[0]).trim(),
        abbr: String(row[2]).trim(),
        officialKey: String(row[4]).trim()
      };
    }).filter(function(item) { return item.officialKey !== ""; });
  },

  _processWooSkuLogic: function(rawName, mapData) {
    for (var i = 0; i < mapData.length; i++) {
      if (rawName.includes(mapData[i].officialKey)) {
        return { sku: mapData[i].internalSku, abbr: mapData[i].abbr };
      }
    }
    return { sku: "Unknown", abbr: "?" };
  }
};