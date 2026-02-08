from quart import Blueprint, request, jsonify, send_file, Response
from crypto_utils import encrypt_data, decrypt_data
from FRI import (
    FRIClient, 
    fri_auth, 
    fri_count, 
    fri_data, 
    fetch_and_decrypt_all, 
    save_to_excel
)
from dataverse import create_row_file, read_row, download_file
import io
import traceback
import logging

logger = logging.getLogger(__name__)
routes = Blueprint("routes", __name__)


@routes.route("/health", methods=["GET"])
async def health():
    return {"status": "API is working"}, 200


@routes.route("/encrypt", methods=["POST"])
async def encrypt():
    try:
        key_id = request.headers.get("X-PUBLIC-KEY-ID")
        if not key_id:
            return {"error": "X-PUBLIC-KEY-ID header required"}, 400
        
        payload = await request.json
        result = encrypt_data(payload, key_id)
        return jsonify(result), 200
    
    except Exception as e:
        logger.error(f"Encryption error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/decrypt", methods=["POST"])
async def decrypt():
    try:
        payload = await request.json
        result = decrypt_data(payload)
        return jsonify(result), 200
    
    except Exception as e:
        logger.error(f"Decryption error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/fri/auth", methods=["POST"])
async def auth():
    try:
        key_id = "FRI"
        if not key_id:
            return {"error": "KEY-ID is required"}, 400
        
        response = await fri_auth(key_id)
        return {"token": response}, 200
    
    except Exception as e:
        logger.error(f"Auth error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/fri/count", methods=["POST"])
async def count():
    try:
        key_id = "FRI"
        if not key_id:
            return {"error": "KEY-ID is required"}, 400
        
        req = await request.json
        date = req.get("date")
        
        if not date:
            return {"error": "date is required"}, 400
        
        response = await fri_count(key_id=key_id, count_date=date)
        logger.info(f"Count: {response}")
        return response, 200
    
    except Exception as e:
        logger.error(f"Count error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/fri/data/test", methods=["POST"])
async def data_test():
    try:
        key_id = "FRI"
        req = await request.json
        
        # Validate required fields
        required_fields = ["date", "offset", "count", "client_id"]
        for field in required_fields:
            if field not in req:
                return {"error": f"{field} is required"}, 400
        
        response = await fri_data(
            key_id=key_id,
            date=req.get("date"),
            offset=req.get("offset"),
            count=req.get("count"),
            client_id=req.get("client_id")
        )
        return response, 200
    
    except Exception as e:
        logger.error(f"Data test error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/fri/data", methods=["POST"])
async def data():
    try:
        key_id = "FRI"
        req = await request.json
        
        date = req.get("date")
        client_id = req.get("client_id")
        total_count = req.get("total_count", 9107)
        batch_size = req.get("batch_size", 3000)
        
        if not date or not client_id:
            return {"error": "date and client_id are required"}, 400
        
        response = await fetch_and_decrypt_all(
            key_id=key_id,
            total_count=total_count,
            date=date,
            client_id=client_id,
            batch_size=batch_size
        )
        return jsonify(response), 200
    
    except Exception as e:
        logger.error(f"Data error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/fri/data/excel", methods=["POST"])
async def data_excel():
    try:
        key_id = "FRI"
        req = await request.json
        
        date = req.get("date")
        client_id = req.get("client_id", "123412114")
        batch_size = req.get("batch_size", 3000)
        
        if not date:
            return {"error": "date is required"}, 400
        
        # Get count
        count_res = await fri_count(key_id=key_id, count_date=date)
        total_count = count_res.get("count")
        
        if not total_count:
            return {"error": "No records found"}, 404
        
        logger.info(f"Total count: {total_count}")
        
        # Fetch all data
        response = await fetch_and_decrypt_all(
            key_id=key_id,
            total_count=total_count,
            date=date,
            client_id=client_id,
            batch_size=batch_size
        )
        
        # Save to Excel
        columns = ['fri', 'isa_id', 'mobile_no', 'status', 'tsp_id']
        output = io.BytesIO()
        save_to_excel(response, output, columns)
        output.seek(0)
        
        return await send_file(
            output,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"fri_data_{date}.xlsx"
        )
    
    except Exception as e:
        logger.error(f"Excel export error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/dataverse/save", methods=["POST"])
async def upload_file():
    try:
        files = await request.files
        form = await request.form
        
        file = files.get('file')
        record_count = form.get('record_count')
        export_date = form.get('export_date')
        form_type = form.get('type', '').upper()
        
        if not file or not record_count or not export_date or not form_type:
            return {"error": "Missing required fields"}, 400
        
        contents = file.read()
        filename = file.filename
        
        row = {
            'cr1d9_recordcount': record_count,
            'cr1d9_exportdate': export_date
        }
        
        if form_type == 'FRI':
            table_name = 'cr1d9_fri_downloads'
        elif form_type == 'MNRL':
            data_type = form.get('data_type')
            if not data_type:
                return {"error": "data_type required for MNRL"}, 400
            row['cr1d9_datatype'] = data_type
            table_name = 'cr1d9_mnrl_downloads'
        else:
            return {"error": f"Invalid type: {form_type}"}, 400
        
        result = create_row_file(
            table_name=table_name,
            row=row,
            file_col_name='cr1d9_file',
            filename=filename,
            contents=contents
        )
        
        return jsonify({'success': True, 'result': result})
    
    except Exception as e:
        logger.error(f"Upload error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/dataverse/list", methods=["GET"])
async def list_files():
    try:
        req_type = request.args.get('type', 'FRI').upper()
        
        if req_type == 'FRI':
            table_name = 'cr1d9_fri_downloads'
        elif req_type == 'MNRL':
            table_name = 'cr1d9_mnrl_downloads'
        else:
            return {"error": f"Invalid type: {req_type}"}, 400
        
        result = read_row(table_name=table_name)
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"List error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500


@routes.route("/dataverse/download/<fileId>", methods=["GET"])
async def download(fileId):
    try:
        req_type = request.args.get('type', 'FRI').upper()
        
        if req_type == 'FRI':
            table_name = 'cr1d9_fri_downloads'
        elif req_type == 'MNRL':
            table_name = 'cr1d9_mnrl_downloads'
        else:
            return {"error": f"Invalid type: {req_type}"}, 400
        
        data, fileName = download_file(
            table_name=table_name,
            row_id=fileId,
            file_col_name="cr1d9_file"
        )
        
        return Response(
            data,
            mimetype="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{fileName}"'
            }
        )
    
    except Exception as e:
        logger.error(f"Download error: {str(e)}\n{traceback.format_exc()}")
        return {"error": str(e)}, 500