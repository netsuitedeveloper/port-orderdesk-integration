/**
 *@NApiVersion 2.1
 *@NScriptType Suitelet
 */
define(["N/record", "N/search", "N/file", "N/log"], (
  record,
  search,
  file,
  log
) => {
  const onRequest = (context) => {

    const odData = JSON.parse(context.request.body);

    const odMode = odData.mode;
    let returnMsg;

    try {
      if (odMode == "order_creation") {
        returnMsg = createOrder(odData, false);
      } else if (odMode == "order_fulfillment") {
        returnMsg = createOrder(odData, true);
      } else if (odMode == "inventory_item_update") {
        returnMsg = {
          success: true,
          reason: `Recognized inventory item update mode for testing: ${odMode}`,
        };
      } else if (odMode == "order_item_update") {
        returnMsg = {
          success: true,
          reason: `Recognized order item update mode for testing: ${odMode}`,
        };
      } else {
        returnMsg = {
          success: false,
          reason: `Unrecognized api mode: ${odMode}`,
        };
      }
    } catch (e) {
      returnMsg = {
        success: false,
        reason: e.message,
      };
    }

    if (!returnMsg.success) {
      errorLog(
        odMode,
        JSON.stringify(odData),
        returnMsg
      );
    }

    context.response.write(JSON.stringify(returnMsg));

    return true;
  };

  const createOrder = (data, addFulfill) => {
    const odPo = data.order.id;

    // confirm existing, add fulfillment
    const existingOrder = searchOrderByPo(odPo);
    if (existingOrder) {
      if (addFulfill) {
        // !!! add fulfillment info to existing order record !!!
        return {
          success: true,
          reason: `Same PO# sales order (internalid: ${existingOrder}) found.`,
        };
      } else {
        return {
          success: true,
          reason: `Same PO# sales order (internalid: ${existingOrder}) found.`,
        };
      }
    }

    // check/create customer
    let custId = searchCustomer(data.order.email);
    if (!custId) {
      const returnObj = createCustomer(data.order);
      if (returnObj.success) {
        custId = returnObj.id;
      } else {
        return {
          success: false,
          reason: `Failed to create new customer. (email: ${data.order.email}) Reason: ${returnObj.reason}.`,
        };
      }
    }

    // check/create items
    let itemIdArr = [];
    for (
      let iOdItem = 0;
      data.order.order_items && iOdItem < data.order.order_items.length;
      iOdItem++
    ) {
      const itemSku = data.order.order_items[iOdItem].code;
      let itemSoId = searchItem(itemSku);
      if (!itemSoId) {
        const returnObj = createItem(data.order.order_items[iOdItem]);
        if (returnObj.success) {
          itemSoId = returnObj.id;
        } else {
          return {
            success: false,
            reason: `Failed to create new item. (code: ${itemSku}) Reason: ${returnObj.reason}.`,
          };
          // send email
        }
      }
      itemIdArr.push(itemSoId);
    }
    log.debug("itemIdArr", itemIdArr);

    // create sales order
    const returnObj = createSalesOrder(data, odPo, custId, itemIdArr);
    if (returnObj.success) {
      soId = returnObj.id;
      return {
        success: true,
        reason: `Sales order (internalid: ${soId}) is created.`,
      };
    } else {
      return {
        success: false,
        reason: `Failed to create new sales order. (order id: ${odPo}) Reason: ${returnObj.reason}.`,
      };
    }

    // // !!! add fulfillment info to existing order record !!!
    // if (addFulfill) {
    // }
  };

  // create error log custom record
  const errorLog = (mode, contents, returnMsg) => {
    try {
      const CURRENT_DATE = new Date();
      const fileObj = file.create({
        name: CURRENT_DATE.getTime() + ".txt",
        fileType: file.Type.PLAINTEXT,
        contents: contents,
        encoding: file.Encoding.UTF8,
        folder: 124,
        isOnline: false,
      });
      const fileId = fileObj.save();

      const id = (mode == "order_creation" || "order_fulfillment") ? odData.order.id : '';

      const objRecord = record.create({
        type: "customrecord_od_err_log",
        isDynamic: true,
      });
      objRecord.setValue({ fieldId: "custrecord_od_log_od_id", value: id });
      objRecord.setValue({ fieldId: "custrecord_od_log_mode", value: mode });
      objRecord.setValue({
        fieldId: "custrecord_od_log_datetime",
        value: getRunningTime(CURRENT_DATE),
      });
      objRecord.setValue({
        fieldId: "custrecord_od_log_issuccess",
        value: returnMsg.success,
      });
      objRecord.setValue({
        fieldId: "custrecord_od_log_reason",
        value: returnMsg.reason,
      });
      objRecord.setValue({ fieldId: "custrecord_od_log_file", value: fileId });
      const recordId = objRecord.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });

      return {
        success: true,
        id: recordId,
      };
    } catch (error) {
      log.debug("error Log err", error);
      return {
        success: false,
        reason: error.message,
      };
    }
  };

  // search customer by email
  const searchCustomer = (email) => {
    const srch = search.create({
      type: "customer",
      filters: [
        search.createFilter({
          name: "email",
          operator: search.Operator.IS,
          values: email,
        }),
      ],
      columns: [],
    });
    const results = srch.run().getRange(0, 1);
    return results.length > 0 ? results[0].id : false;
  };

  // create new customer
  const createCustomer = (data) => {
    try {
      const objRecord = record.create({
        type: "customer",
        isDynamic: true,
      });
      objRecord.setValue({ fieldId: "isperson", value: "T" });
      objRecord.setValue({
        fieldId: "firstname",
        value: data.customer.first_name,
      });
      objRecord.setValue({
        fieldId: "lastname",
        value: data.customer.last_name,
      });
      objRecord.setValue({ fieldId: "email", value: data.email });
      objRecord.setValue({ fieldId: "phone", value: data.customer.phone });

      objRecord.selectNewLine({
        sublistId: "addressbook",
      });
      let addressSubrecord = objRecord.getCurrentSublistSubrecord({
        sublistId: "addressbook",
        fieldId: "addressbookaddress",
      });
      addressSubrecord.setValue({
        fieldId: "addressee",
        value: data.customer.first_name + " " + data.customer.last_name,
      });
      addressSubrecord.setValue({
        fieldId: "addr1",
        value: data.customer.address1 ? data.customer.address1 : "",
      });
      addressSubrecord.setValue({
        fieldId: "addr2",
        value: data.customer.address2 ? data.customer.address2 : "",
      });
      addressSubrecord.setValue({
        fieldId: "city",
        value: data.customer.city ? data.customer.city : "",
      });
      addressSubrecord.setValue({
        fieldId: "state",
        value: data.customer.state ? data.customer.state : "",
      });
      addressSubrecord.setValue({
        fieldId: "zip",
        value: data.customer.postal_code ? data.customer.postal_code : "",
      });
      addressSubrecord.setValue({
        fieldId: "country",
        value: data.customer.country ? data.customer.country : "",
      });
      addressSubrecord.setValue({
        fieldId: "addrphone",
        value: data.customer.phone ? data.customer.phone : "",
      });
      addressSubrecord.setValue({
        fieldId: "defaultshipping",
        value: "T",
      });
      addressSubrecord.setValue({
        fieldId: "defaultbilling",
        value: "T",
      });
      objRecord.commitLine({
        sublistId: "addressbook",
      });
      const recordId = objRecord.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });
      log.debug("create Customer", recordId);
      return {
        success: true,
        id: recordId,
      };
    } catch (error) {
      log.debug("create Customer err", error);
      return {
        success: false,
        reason: error.message,
      };
    }
  };

  // search Item by sku
  const searchItem = (sku) => {
    const srch = search.create({
      type: "inventoryitem",
      filters: [
        search.createFilter({
          name: "itemid",
          operator: search.Operator.IS,
          values: sku,
        }),
      ],
      columns: [],
    });
    const results = srch.run().getRange(0, 1);
    return results.length > 0 ? results[0].id : false;
  };

  // create new item
  const createItem = (data) => {
    try {
      const objRecord = record.create({
        type: "lotnumberedinventoryitem",
        isDynamic: true,
      });
      objRecord.setValue({ fieldId: "itemid", value: data.code });
      objRecord.setValue({ fieldId: "salesdescription", value: data.name });
      objRecord.setValue({ fieldId: "costingmethod", value: "AVG" });
      objRecord.setValue({ fieldId: "taxschedule", value: 1 });
      objRecord.selectLine({
        sublistId: "price1",
        line: 0,
      });
      objRecord.setCurrentSublistValue({
        sublistId: "price1",
        fieldId: "currency",
        value: 1,
        ignoreFieldChange: true,
      });
      objRecord.setCurrentSublistValue({
        sublistId: "price1",
        fieldId: "price_1_",
        value: data.price,
        ignoreFieldChange: true,
      });
      objRecord.commitLine({
        sublistId: "price1",
      });
      const recordId = objRecord.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });

      log.debug("create Item", recordId);
      return {
        success: true,
        id: recordId,
      };
    } catch (error) {
      log.debug("create Item err", error);
      return {
        success: false,
        reason: error.message,
      };
    }
  };

  // search sals order by PO
  const searchOrderByPo = (po) => {
    const srch = search.create({
      type: "salesorder",
      filters: [
        search.createFilter({
          name: "otherrefnum",
          operator: search.Operator.EQUALTO,
          values: po,
        }),
        search.createFilter({
          name: "mainline",
          operator: search.Operator.IS,
          values: "T",
        }),
      ],
      columns: [],
    });
    const results = srch.run().getRange(0, 1);
    return results.length > 0 ? results[0].id : false;
  };

  // create sales order
  const createSalesOrder = (data, po, customer, itemIdArr) => {
    try {
      const objRecord = record.create({
        type: "salesorder",
        isDynamic: true,
        defaultValues: {
          entity: customer,
        },
      });
      objRecord.setValue({ fieldId: "otherrefnum", value: po });
      objRecord.setValue({
        fieldId: "trandate",
        value: new Date(data.order.date_added),
      });
      objRecord.setValue({
        fieldId: "custbody_od_order_id",
        value: data.order.id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_customer_id",
        value: data.order.customer_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_source_name",
        value: data.order.source_name,
      });
      objRecord.setValue({
        fieldId: "custbody_od_source_id",
        value: data.order.source_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_fulfil_name",
        value: data.order.fulfillment_name,
      });
      objRecord.setValue({
        fieldId: "custbody_od_fulfil_id",
        value: data.order.fulfillment_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_order_id",
        value: data.order.order_metadata.shopify_order_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_source",
        value: data.order.order_metadata.shopify_source,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_src_name",
        value: data.order.order_metadata.shopify_source_name,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_user_id",
        value: data.order.order_metadata.shopify_user_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_checkout_id",
        value: data.order.order_metadata.shopify_checkout_id,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_vendor",
        value: data.order.order_metadata.shopify_vendor,
      });
      objRecord.setValue({
        fieldId: "custbody_od_shopify_currency",
        value: data.order.order_metadata.currency,
      });
      objRecord.setValue({
        fieldId: "custbody_od_mode",
        value: data.mode,
      });
      objRecord.setValue({
        fieldId: "custbody_od_notify_url",
        value: data.notification_url,
      });

      for (
        let iItem = 0;
        data.order.order_items && iItem < data.order.order_items.length;
        iItem++
      ) {
        const lineItemInfo = data.order.order_items[iItem];

        objRecord.selectNewLine({
          sublistId: "item",
        });
        objRecord.setCurrentSublistValue({
          sublistId: "item",
          fieldId: "item",
          value: itemIdArr[iItem],
        });
        objRecord.setCurrentSublistValue({
          sublistId: "item",
          fieldId: "price",
          value: -1,
        });
        objRecord.setCurrentSublistValue({
          sublistId: "item",
          fieldId: "quantity",
          value: lineItemInfo.quantity,
        });
        objRecord.setCurrentSublistValue({
          sublistId: "item",
          fieldId: "rate",
          value: lineItemInfo.price,
        });
        objRecord.commitLine({
          sublistId: "item",
        });
      }
      const recordId = objRecord.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });

      log.debug("create SalesOrder", recordId);
      return {
        success: true,
        id: recordId,
      };
    } catch (error) {
      log.debug("create SalesOrder err", error);
      return {
        success: false,
        reason: error.message,
      };
    }
  };

  const getRunningTime = (d) => {
    // const d = new Date();
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString();
    const dd = d.getDate().toString();
    const time = formatAMPM(d);
    const val =
      (mm[1] ? mm : mm[0]) +
      "/" +
      (dd[1] ? dd : dd[0]) +
      "/" +
      yyyy +
      " " +
      time;
    return val;
  };

  const formatAMPM = (date) => {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? "0" + minutes : minutes;
    const strTime = hours + ":" + minutes + ":" + seconds + " " + ampm;
    return strTime;
  };

  return { onRequest };
});
