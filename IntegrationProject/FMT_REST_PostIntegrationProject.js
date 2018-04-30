/*
 ***********************************************************************
 *
 * The following javascript code is created by FMT Consultants LLC,
 * a NetSuite Partner. It is a SuiteFlex component containing custom code
 * intended for NetSuite (www.netsuite.com) and use the SuiteScript API.
 * The code is provided "as is": FMT Consultants LLC shall not be liable
 * for any damages arising out the intended use or if the code is modified
 * after delivery.
 *
 * Company:     FMT Consultants LLC, www.fmtconsultants.com
 * Author:      ibudimir@fmtconsultants.com
 * File:        FMT_REST_PostIntegrationProject.js
 * Date:        08/30/2016
 *
 * Note | This RESTlet uses and must be deployed with the following library:
 * FMT_LIB_IntegrationProject.js
 *
 ***********************************************************************/

var SCRIPT_ID = 'FMT_REST_PostIntegrationProject.js';
/**
 * POST Restlet function, uses Integration Project custom record schema
 * to translate a JSON object into NetSuite record / transaction. Note the mapping is based on the schema
 * and parsing is fully dynamic.
 *
 * If successful the function will return an integer, record id, otherwise it will return an error message to
 * the calling party.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {Object} datain
 * @returns {integer} recId / error
 */
function postIntegrationProject(datain) {
    if (isEmpty(datain)) {
        return buildErrorMessage("No record / transaction was sent to the Integration Project Restlet", SCRIPT_ID);
    }

    var ctx = nlapiGetContext();
    var integrationProjectInternalId = ctx.getSetting('SCRIPT', 'custscript_integration_project');

    if (!isEmpty(integrationProjectInternalId)) {
        var integrationProject = nlapiLoadRecord('customrecord_fmt_integration_project', integrationProjectInternalId);
        var recordType = integrationProject.getFieldText('custrecord_ip_record_type');

        if (recordType == 'Transaction') {
            var transactionType = integrationProject.getFieldText('custrecord_ip_transaction_type');
            if (!isEmpty(transactionType)) {
                !isEmpty(TRANSACTION_CONVERSION_TABLE[transactionType]) ? ( recordType = TRANSACTION_CONVERSION_TABLE[transactionType]) : buildErrorMessage("Integration Project record was not configured properly.", SCRIPT_ID);
            } else {
                return buildErrorMessage("Integration Project record was not configured properly.", SCRIPT_ID);
            }
        }

        if (SS_TO_TRANSACTION_CONVERSION_TABLE.ItemRcpt != recordType && SS_TO_TRANSACTION_CONVERSION_TABLE.ItemShip != recordType) {
            return setNlobjRecord(datain, integrationProjectInternalId, recordType);
        } else {
            var targetType = recordType;
            var sourceType = null;

            switch(targetType) {
            case SS_TO_TRANSACTION_CONVERSION_TABLE.ItemRcpt:
                sourceType = SS_TO_TRANSACTION_CONVERSION_TABLE.PurchOrd;
                break;

            case SS_TO_TRANSACTION_CONVERSION_TABLE.ItemShip:
                sourceType = SS_TO_TRANSACTION_CONVERSION_TABLE.SalesOrd;
                break;

            default:
                return buildErrorMessage("This transaction transformation is not supported.", SCRIPT_ID);
            }

            return transformNlobjRecord(datain, integrationProjectInternalId, sourceType, targetType);
        }
    } else {
        return buildErrorMessage("Integration Project record was not configured properly.", SCRIPT_ID);
    }
}
