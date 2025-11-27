import logging
import os
import pathlib
from concurrent.futures import ThreadPoolExecutor

import oss2
from fastapi import (
    Body,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Path,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

PROD = os.getenv("PROD") == "1"
if not PROD:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

DIST_PATH = pathlib.Path(__file__).parent / "dist"

app.mount("/static", StaticFiles(directory=DIST_PATH / "static"), name="dist")


def get_parent(path: str):
    if "/" not in path or "/" not in path[:-1]:
        return ""
    if path.endswith("/"):
        path = path[:-1]
    return path[: path.rindex("/") + 1]


def get_basename(path: str):
    if path.endswith("/"):
        return path.split("/")[-2] + "/"
    return path.split("/")[-1]


def get_target_path(source_key: str, target_dir: str, rename=""):
    assert target_dir == "" or target_dir.endswith("/")
    if not rename:
        return target_dir + get_basename(source_key)
    return target_dir + rename + "/" * source_key.endswith("/")


@app.get("/")
async def serve_index():
    index_path = DIST_PATH / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"error": "File Not Found"}, 404


@app.get("/{file}")
async def serve_file(file: str = Path(..., pattern=r"^(icon\.svg)$")):
    index_path = DIST_PATH / file
    if index_path.exists():
        return FileResponse(index_path)
    return {"error": "File Not Found"}, 404


def get_oss_bucket(
    access_key: str, secret_key: str, endpoint: str, bucket_name: str
) -> oss2.Bucket:
    try:
        auth = oss2.AuthV2(access_key, secret_key)
        bucket = oss2.Bucket(auth, endpoint, bucket_name)
        bucket.object_exists("example")
    except oss2.exceptions.SignatureDoesNotMatch:
        raise HTTPException(401, "oss 认证不通过！")
    except oss2.exceptions.AccessDenied:
        raise HTTPException(403, "oss 拒绝访问！")
    except oss2.exceptions.NoSuchBucket:
        raise HTTPException(404, f"oss bucket {bucket_name!r} 不存在！")
    except Exception:
        raise HTTPException(500, "oss 配置无效！")
    return bucket


@app.post("/api/list/")
async def list_files(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    path: str = Body("", pattern=r"^(|.*/)$", description="文件路径"),
    limit: int = Body(200, description="单次返回数量限制，避免卡死"),
    dir: bool = Body(False, description="只返回目录"),
):
    """列出 OSS 文件/目录"""
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)

    files = []

    counter = 0
    has_more = False
    try:
        for obj in oss2.ObjectIterator(oss_bucket, prefix=path, delimiter="/"):
            if obj.is_prefix():  # 目录
                files.append(
                    {
                        "name": get_basename(obj.key),
                        "key": obj.key,
                        "size": obj.size,
                        "last_modified": obj.last_modified,  # 格式化后的时间
                    }
                )
            elif not dir:  # 文件
                if obj.key.endswith("/"):
                    # 如果在 oss 上手动创建了文件夹，就会出现这种情况。
                    # 特别地，如果创建的文件夹就是自己，也会被遍历到。
                    # 此时不应该返回自己，因为自己应该在上一层目录显示。
                    if obj.key == path:
                        continue
                files.append(
                    {
                        "name": get_basename(obj.key),
                        "key": obj.key,
                        "size": obj.size,
                        "last_modified": obj.last_modified,  # 格式化后的时间
                    }
                )
            counter += 1
            if 0 < limit <= counter:
                has_more = True
                break
    except Exception as e:
        logging.exception(e)
        raise HTTPException(500, f"读取文件列表失败: {str(e)}")

    def sort_key(file):
        return (not file["name"].endswith("/"), file["name"].lower())

    files.sort(key=sort_key)

    return JSONResponse(
        {
            "path": path,
            "parent": get_parent(path),
            "files": files,
            "has_more": has_more,
        }
    )


@app.post("/api/upload/")
async def upload_file(
    key: str = Header(...),
    secret: str = Header(...),
    endpoint: str = Header(...),
    bucket: str = Header(...),
    path: str = Form(..., pattern=r"^.*/$"),
    file: UploadFile = File(...),
):
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)

    object_key = f"{path}{file.filename}"

    try:
        oss_bucket.put_object(object_key, await file.read())
        return JSONResponse({"status": "success", "key": object_key})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@app.post("/api/share/")
async def generate_share_url(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    file_keys: list[str] = Body(..., description="文件 Key"),
    expire: int = Body(604800, description="有效期（秒，默认7天）"),
):
    for file_key in file_keys:
        if not file_key or file_key.endswith("/"):
            return JSONResponse({"err": f"not a file: {file_key!r}"}, status_code=400)
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    share_urls = []
    for file_key in file_keys:
        try:
            share_urls.append(
                oss_bucket.sign_url("GET", file_key, expire, slash_safe=False)
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"生成分享链接失败: {str(e)}")
    return JSONResponse({"share_urls": dict(zip(file_keys, share_urls))})


@app.post("/api/delete/")
async def delete_file(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    src_keys: list[str] = Body(..., description="文件 Key", embed=True),
):
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    err, norm_src_keys = _validate_src(oss_bucket, src_keys)
    if err:
        return JSONResponse({"ok": False, "err": err}, status_code=400)
    try:
        oss_bucket.batch_delete_objects(norm_src_keys)
        return JSONResponse({"ok": True}, status_code=200)
    except oss2.exceptions.OssError as e:
        return JSONResponse({"ok": False, "err": str(e)}, status_code=500)


@app.post("/api/copy/")
async def copy_file(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    src_keys: list[str] = Body(..., description="文件 Key"),
    target_dir: str = Body(..., pattern=r"^(|.*/)$", description="目标文件夹"),
    rename: str = Body("", pattern=r"^[^/]*$", description="复制的同时重命名"),
):
    if rename and len(src_keys) > 1:
        return JSONResponse(
            {"err": "cannot rename more than one file/directory"}, status_code=400
        )
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    failed, err = _copy_file(
        oss_bucket,
        src_keys,
        [get_target_path(s, target_dir, rename) for s in src_keys],
    )
    if err:
        return JSONResponse({"err": err}, status_code=400)
    return JSONResponse({"ok": not failed, "failed": failed}, status_code=200)


@app.post("/api/move/")
async def move_file(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    src_keys: list[str] = Body(..., description="文件 Key"),
    target_dir: str = Body(..., pattern=r"^(|.*/)$", description="目标文件夹"),
    rename: str = Body("", pattern=r"^[^/]*$", description="复制的同时重命名"),
):
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    if rename and len(src_keys) > 1:
        return JSONResponse(
            {"err": "cannot rename more than one file/directory"}, status_code=400
        )
    failed, err = _move_file(
        oss_bucket,
        src_keys,
        [get_target_path(s, target_dir, rename) for s in src_keys],
    )
    if err:
        return JSONResponse({"err": err}, status_code=400)
    return JSONResponse({"ok": not failed, "failed": failed}, status_code=200)


@app.post("/api/rename/")
async def rename_file(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    file_key: str = Body(..., pattern=r"^.+$", description="文件 Key"),
    new_name: str = Body(..., pattern=r"^[^/]+$", description="新名称"),
):
    oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    new_key = get_parent(file_key) + new_name + "/" * file_key.endswith("/")

    if file_key == new_key:
        return JSONResponse({"ok": True})
    failed = _move_file(oss_bucket, [file_key], [new_key])
    return JSONResponse({"ok": not failed, "failed": failed}, status_code=200)


@app.post("/api/preview/")
async def preview_file(
    key: str = Header(..., description="OSS AccessKey"),
    secret: str = Header(..., description="OSS SecretKey"),
    endpoint: str = Header(..., description="OSS Endpoint"),
    bucket: str = Header(..., description="OSS Bucket 名称"),
    file_key: str = Body(..., description="文件 key"),
    max_size: int = Body(1024 * 1024, description="最大不截断文件大小"),
):
    def err(msg: str):
        return PlainTextResponse(msg, 400)

    if file_key.endswith("/") or file_key == "":
        return err("cannot preview a directory")
    try:
        oss_bucket = get_oss_bucket(key, secret, endpoint, bucket)
    except HTTPException as e:
        return err(e.detail)
    try:
        obj = oss_bucket.get_object(file_key)
    except oss2.exceptions.NoSuchKey:
        return err("file not exist")

    file_size = obj.content_length or 0
    if file_size <= 0:
        return err("file is empty")
    truncated = file_size > max_size
    if truncated:
        content = obj.read(max_size)
    else:
        content = obj.read() or b""
    assert isinstance(content, bytes)
    headers = {"truncated": str(int(truncated)), "file_size": str(file_size)}
    is_pure_text = True
    if not truncated:
        try:
            content.decode("utf-8")
        except Exception:
            is_pure_text = False

    if truncated or is_pure_text:
        return Response(content, media_type="text/plain;charset=utf-8", headers=headers)

    if obj.content_type in {
        "image/bmp",
        "image/gif",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/svg+xml",
        "image/webp",
        "audio/aac",
        "application/pdf",
        "video/mp4",
    }:
        # 这些是 chrome 可以直接预览的格式。
        media_type = obj.content_type
    else:
        # 其余的都解析成文本文件预览，哪怕是乱码
        media_type = "text/plain;charset=utf-8"

    return Response(content, media_type=media_type, headers=headers)


def _validate_src(bucket: oss2.Bucket, source_keys: list[str]):
    try:
        norm_source_keys = []
        total_size = 0
        for s in source_keys:
            if s.endswith("/"):
                for obj in oss2.ObjectIterator(bucket, prefix=s):
                    if obj.is_prefix():
                        assert False
                    else:
                        # if obj.key == s:
                        #     continue
                        total_size += obj.size
                        norm_source_keys.append(obj.key)
                    if len(norm_source_keys) > 1000:
                        return "too many file", None
                    if total_size > 100 * 1024 * 1024 * 1024:
                        return "files too large", None
            else:
                try:
                    meta = bucket.get_object_meta(s)
                except oss2.exceptions.OssError:
                    return f"source not exist: {s}", None
                total_size += meta.content_length or 0
                if total_size > 100 * 1024 * 1024 * 1024:
                    return "files too large", None
                norm_source_keys.append(s)
        return None, norm_source_keys
    except oss2.exceptions.OssError as e:
        return f"oss 操作失败: {e}", None


def _validate_src_tgt(
    bucket: oss2.Bucket,
    source_keys: list[str],
    target_keys: list[str],
    allow_overwrite=False,
) -> tuple[None, list[str], list[str]] | tuple[str, None, None]:
    if len(target_keys) != len(source_keys):
        return "not equal length", None, None
    # source_keys = [re.sub(r"/+", "/", p) for p in source_keys]
    # target_keys = [re.sub(r"/+", "/", p) for p in target_keys]
    try:
        norm_source_keys: list[str] = []
        norm_target_keys: list[str] = []
        total_size = 0
        for s, t in zip(source_keys, target_keys):
            if s.endswith("/"):
                if not t.endswith("/"):
                    return "try to copy dir to file", None, None
                for obj in oss2.ObjectIterator(bucket, prefix=s):
                    if obj.is_prefix():
                        assert False
                    else:
                        # 如果 src 是一个目录对象，那还是要移动/复制到目标位置的
                        # 所以这里不能 continue
                        # if obj.key == s:
                        #     continue
                        total_size += obj.size
                        norm_source_keys.append(obj.key)
                        # 移动/复制目录，不同于在 posix 文件系统上操作，这里一定是直接替换目录。
                        # 因为没法判断目标目录是否存在。oss 上所有目录可以认为都是存在的。
                        norm_target_keys.append(obj.key.replace(s, t))
                    if len(norm_source_keys) > 1000:
                        return "too many file", None, None
                    if total_size > 100 * 1024 * 1024 * 1024:
                        return "files too large", None, None
            else:
                try:
                    meta = bucket.get_object_meta(s)
                except oss2.exceptions.OssError:
                    return f"source not exist: {s}", None, None
                total_size += meta.content_length or 0
                if total_size > 100 * 1024 * 1024 * 1024:
                    return "files too large", None, None
                if t.endswith("/"):
                    return "source is file but target is dir", None, None
                norm_source_keys.append(s)
                norm_target_keys.append(t)
        if len(norm_target_keys) != len(set(norm_target_keys)):
            return "duplicated target key", None, None

        # 去除那些 src 跟 target 相等的
        pairs = [(s, t) for s, t in zip(norm_source_keys, norm_target_keys) if s != t]
        dedup_source_keys, dedup_target_keys = zip(*pairs) if pairs else ([], [])
        if set(dedup_source_keys) & set(dedup_target_keys):
            return "source overlaps target", None, None

        if not allow_overwrite:
            for t in dedup_target_keys:
                if bucket.object_exists(t):
                    return f"will overwrite {t}", None, None
        return None, list(dedup_source_keys), list(dedup_target_keys)
    except oss2.exceptions.OssError as e:
        return f"oss 操作失败: {e}", None, None


def _move_file(
    bucket: oss2.Bucket,
    source_keys: list[str],
    target_keys: list[str],
    allow_overwrite=False,
):
    err, s_keys, t_keys = _validate_src_tgt(
        bucket, source_keys, target_keys, allow_overwrite
    )
    if err is not None:
        return [], err
    assert s_keys is not None and t_keys is not None

    def _move(s_t: tuple[str, str]):
        source_key, target_key = s_t

        try:
            assert source_key != target_key, "not expected here"
            bucket.copy_object(bucket.bucket_name, source_key, target_key)

            if not bucket.object_exists(target_key):
                return "复制后目标文件不存在"

            bucket.delete_object(source_key)

            if bucket.object_exists(source_key):
                return "原文件删除失败"
            return None
        except oss2.exceptions.OssError as e:
            return f"移动失败: {e}"

    failed = []
    with ThreadPoolExecutor() as executor:
        for s, t, err in zip(s_keys, t_keys, executor.map(_move, zip(s_keys, t_keys))):
            if err is not None:
                failed.append({"src": s, "tgt": t, "err": err})
    return failed, None


def _copy_file(
    bucket: oss2.Bucket,
    source_keys: list[str],
    target_keys: list[str],
    allow_overwrite=False,
):
    err, s_keys, t_keys = _validate_src_tgt(
        bucket, source_keys, target_keys, allow_overwrite
    )
    if err is not None:
        return [], err
    assert s_keys is not None and t_keys is not None, "make type hint happy"

    def _copy(s_t: tuple[str, str]):
        source_key, target_key = s_t
        try:
            assert source_key != target_key
            bucket.copy_object(bucket.bucket_name, source_key, target_key)
            return None
        except oss2.exceptions.OssError as e:
            return f"复制失败: {e}"

    failed = []
    with ThreadPoolExecutor() as executor:
        for s, t, err in zip(s_keys, t_keys, executor.map(_copy, zip(s_keys, t_keys))):
            if err is not None:
                failed.append({"src": s, "tgt": t, "err": err})
    return failed, None


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "__main__:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", 3000)) if PROD else 8000,
        reload=not PROD,
        workers=4,
        log_level="info",
        access_log=not PROD,
    )
