import os
import sys
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from redact import _get_paddle
import pipeline

app = FastAPI()

class ProcessRequest(BaseModel):
    raw_path: str
    mrn: str
    patientlog_root: str

@app.post("/process")
def process_doc(req: ProcessRequest):
    try:
        manifest = pipeline.run(req.raw_path, req.mrn, req.patientlog_root)
        return manifest
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("Starting uvicorn server on port 8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000)
