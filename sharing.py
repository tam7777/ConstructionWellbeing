"""Loopback adapter behind this project's Cloudflare Quick Tunnel."""
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from starlette.responses import PlainTextResponse, StreamingResponse

ORIGIN_FILE=Path(__file__).parent/'sharing-origin.json'
HOP_HEADERS={'connection','keep-alive','proxy-authenticate','proxy-authorization',
             'te','trailer','transfer-encoding','upgrade'}


def origin_allowed(method,origin,fetch_site,public_origin):
    if origin and origin!=public_origin:
        return False
    return method in ('GET','HEAD','OPTIONS') or fetch_site!='cross-site'


def read_origin():
    try:
        return json.loads(ORIGIN_FILE.read_text())['origin']
    except (OSError,ValueError,KeyError):
        return None


def create_proxy(client=None,origin_reader=read_origin):
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(timeout=httpx.Timeout(120,connect=10)) as owned:
            app.state.client=owned
            yield
    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

    @app.api_route('/',methods=['GET','HEAD','POST','OPTIONS'])
    @app.api_route('/{path:path}',methods=['GET','HEAD','POST','OPTIONS'])
    async def forward(request:Request,path=''):
        public_origin=origin_reader()
        if not public_origin:
            return PlainTextResponse('Sharing is starting. Retry in a moment.',status_code=503)
        if not origin_allowed(request.method,request.headers.get('origin'),request.headers.get('sec-fetch-site'),public_origin):
            return PlainTextResponse('Open the dashboard directly from its shared link.',status_code=403)
        headers={k:v for k,v in request.headers.items() if k not in HOP_HEADERS|{
            'host','cookie','authorization','cf-access-jwt-assertion','cf-access-authenticated-user-email'}}
        headers['host']='127.0.0.1:8765'
        if 'origin' in headers:
            headers['origin']='http://127.0.0.1:8765'
        raw_path=request.scope['raw_path'].decode('ascii')
        query=request.scope['query_string'].decode('ascii')
        url='http://127.0.0.1:8765'+raw_path+('?' + query if query else '')
        active=client or app.state.client
        outgoing=active.build_request(request.method,url,headers=headers,
            content=None if request.method in ('GET','HEAD') else request.stream())
        try:
            response=await active.send(outgoing,stream=True)
        except httpx.HTTPError:
            return PlainTextResponse('The VM dashboard is unavailable.',status_code=502)
        return StreamingResponse(response.aiter_raw(),status_code=response.status_code,
            headers={k:v for k,v in response.headers.items() if k not in HOP_HEADERS},
            background=BackgroundTask(response.aclose))
    return app


if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_proxy(),host='127.0.0.1',port=8766,access_log=False)
