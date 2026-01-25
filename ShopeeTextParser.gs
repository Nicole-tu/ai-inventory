/**
 * ShopeeTextParser.gs (V2.3)
 * 負責：將蝦皮文字翻譯成系統看得懂的物件，並提取物流單號
 */

var ShopeeTextParser = {
  
  parseShopeeData: function(textData) {
    var skuMap = this._getSkuMap();
    var cleanText = textData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // 依 "訂單編號" 切割
    var rawOrders = cleanText.split(/訂單編號/);
    var orders = [];
    
    rawOrders.forEach(function(block) {
      if (!block || block.trim().length < 10) return;
      var fullBlock = "訂單編號" + block;
      
      var orderIdMatch = fullBlock.match(/訂單編號[:\s]*([A-Z0-9]+)/);
      var logisticsMatch = fullBlock.match(/寄送方式[:\s]*(.+)/);
      
      if (!orderIdMatch) return;

      var orderId = orderIdMatch[1].trim();
      var orderId = orderIdMatch[1].trim();
      var orderId = orderIdMatch[1].trim();
      // 3. 解析物流單號與方式
      // (V2.3 Logic)
      var logistics = "Unknown";
      
      // 嘗試抓取物流單號 (通常在最後面)
      var trackingMatch = fullBlock.match(/(TW\d{10,})/);
      if (!trackingMatch) trackingMatch = fullBlock.match(/7-ELEVEN([A-Z0-9]+)/);
      if (!trackingMatch) trackingMatch = fullBlock.match(/[^\u4e00-\u9fa5]([A-Z0-9]{10,})$/);

      var trackingNumber = trackingMatch ? trackingMatch[1] : "";

      // 嘗試抓取物流方式
      if (logisticsMatch) {
         logistics = logisticsMatch[1].trim();
      } else {
         var endMarker = trackingNumber || "TW"; 
         var logFallback = fullBlock.match(new RegExp("已完成(.*?)" + endMarker));
         if (logFallback && logFallback[1]) {
           logistics = logFallback[1].trim();
         }
      }

      // V2.5.1 New Parsing Logic: Find all "x[Qty]" patterns
      // This handles items without "商品規格:" label and grouped "x3x1" anomalies.
      var xRegex = /[xX]\s*(\d+)/g;
      var match;
      var lastIndex = 0;
      
      while ((match = xRegex.exec(fullBlock)) !== null) {
        var qty = parseInt(match[1], 10) || 1;
        
        // Extract text between previous match and current x[Qty]
        var rawSegment = fullBlock.substring(lastIndex, match.index).trim();
        
        // Update anchor for next iteration
        lastIndex = match.index + match[0].length;
       
        // Filter empty items (e.g., 25gx3x1 -> x1 captures empty string)
        if (rawSegment.length < 2) continue;
        
        // Clean up text
        // Remove "商品規格:" if present
        var specIndex = rawSegment.lastIndexOf("商品規格:");
        var rawName = (specIndex !== -1) 
          ? rawSegment.substring(specIndex + 5).trim() 
          : rawSegment;
          
        // 查表找 SKU
        var mapped = ShopeeTextParser._findSkuInfo(rawName, skuMap);
        
        orders.push({
          date: new Date(),
          orderId: orderId,
          platform: 'Shopee',
          productName: mapped.abbr,
          sku: mapped.sku,
          qty: qty,
          logistics: logistics,
          trackingNumber: trackingNumber,
          raw: rawName
        });
      }
    });
    
    return orders;
  },

  _getSkuMap: function() {
    var ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    var sheet = ss.getSheetByName('[04_SKU對照表]');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    // 讀取 A(SKU), C(簡稱), D(關鍵字)
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    return data.map(function(row) {
      return {
        sku: String(row[0]).trim(),
        abbr: String(row[2]).trim(), 
        keyword: String(row[3]).trim()
      };
    }).filter(function(i) { return i.sku && i.keyword; });
  },

  _findSkuInfo: function(rawName, map) {
    for (var i = 0; i < map.length; i++) {
      if (rawName.includes(map[i].keyword)) {
        return { sku: map[i].sku, abbr: map[i].abbr }; // 回傳 SKU 和簡稱
      }
    }
    // 找不到就回傳原始名稱當作簡稱，方便辨識
    return { sku: "Unknown", abbr: rawName };
  }
};