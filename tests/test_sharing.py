import importlib.util
from pathlib import Path
import httpx
import pytest

spec=importlib.util.spec_from_file_location('sharing',Path(__file__).parents[1]/'sharing.py')
sharing=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sharing)


def test_email_login_redirect_can_navigate_but_cross_site_writes_are_rejected():
    public='https://example.trycloudflare.com'
    assert sharing.origin_allowed('GET',None,'cross-site',public)
    assert not sharing.origin_allowed('POST',None,'cross-site',public)
    assert not sharing.origin_allowed('POST','https://attacker.example','same-origin',public)
    assert sharing.origin_allowed('POST',public,'same-origin',public)


def test_adapter_rewrites_verified_origin_and_preserves_range_and_body():
    import asyncio
    async def run():
        seen=[]
        async def upstream(request):
            seen.append(request)
            return httpx.Response(206 if request.method=='GET' else 200,
                headers={'content-type':'video/mp4','content-range':'bytes 0-3/8'},stream=httpx.ByteStream(b'clip'))
        client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        app=sharing.create_proxy(client,lambda:'https://example.trycloudflare.com')
        browser=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://example.trycloudflare.com')
        try:
            response=await browser.get('/media/clip.mp4',headers={'Range':'bytes=0-3','Sec-Fetch-Site':'cross-site'})
            assert response.status_code==206 and response.content==b'clip'
            assert seen[-1].headers['range']=='bytes=0-3'
            assert response.headers['content-range']=='bytes 0-3/8'
            response=await browser.post('/api/review',headers={'Origin':'https://example.trycloudflare.com','Cookie':'CF_Authorization=private'},json={'reviewed':True})
            assert response.status_code==200
            assert seen[-1].headers['origin']=='http://127.0.0.1:8765'
            assert seen[-1].headers['host']=='127.0.0.1:8765'
            assert 'cookie' not in seen[-1].headers
            assert b'"reviewed":true' in seen[-1].content
            count=len(seen)
            assert (await browser.post('/api/review',headers={'Origin':'https://attacker.example'})).status_code==403
            assert len(seen)==count
        finally:
            await browser.aclose();await client.aclose()
    asyncio.run(run())
