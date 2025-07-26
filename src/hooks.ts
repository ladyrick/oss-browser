import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface OssInfo {
  readonly key: string;
  readonly secret: string;
  readonly endpoint: string;
  readonly bucket: string;
}

export const useGetLowLevelOssAndPath = () => {
  const [params, setSearchParams] = useSearchParams();
  const key = params.get('key') || undefined;
  const secret = params.get('secret') || undefined;
  const endpoint = params.get('endpoint') || undefined;
  const bucket = params.get('bucket') || undefined;

  const partialOss: Partial<OssInfo> = useMemo(() => ({ key, secret, endpoint, bucket }), [key, secret, endpoint, bucket]);
  const path = params.get('path') || '';

  const secretSetSearchParams = (newParams: Partial<OssInfo> & Partial<{ path: string }>) => {
    const filtered = Object.fromEntries(Object.entries(newParams).filter(([, v]) => Boolean(v))) as Record<string, string>;
    setSearchParams({ ['_'.repeat(200)]: '', ...filtered });
    if (filtered.bucket) {
      document.title = filtered.bucket;
    }
  };

  const setOssInfo = (newOss: OssInfo | null) => {
    secretSetSearchParams({ ...newOss, path: path });
  };
  const setPath = (newPath: string) => {
    secretSetSearchParams({ ...partialOss, path: newPath });
  };
  const initialize = () => {
    secretSetSearchParams({ ...partialOss, path: path });
  };
  return { partialOss, path, setOssInfo, setPath, initialize };
};

export const useOssPath = () => {
  const { partialOss, path, setPath } = useGetLowLevelOssAndPath();
  if (partialOss.key === undefined || partialOss.secret === undefined || partialOss.endpoint === undefined || partialOss.bucket === undefined)
    throw new Error('incomplete oss info');
  return { oss: partialOss as OssInfo, path, setPath };
};

export const useMounted = (initMountFunc: () => unknown) => {
  useEffect(() => {
    initMountFunc();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
};
