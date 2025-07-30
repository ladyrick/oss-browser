import { Notification, Typography } from '@arco-design/web-react';
import clipboard from '@arco-design/web-react/es/_util/clipboard';
import { useState } from 'react';
import { useOssPath } from '../hooks';
import { FileList } from './FileList';
import { SimpleButton } from './SimpleButton';

export const OssBrowser: React.FC = () => {
  const { oss, path: initialPath } = useOssPath();
  const [path, setPath] = useState(initialPath);
  const ossutilCmd = `ossutil -i ${oss.key} -k ${oss.secret} -e ${oss.endpoint} ls oss://${oss.bucket}/${path}`;
  return (
    <div style={{ margin: 50, marginTop: 10 }}>
      <Typography.Title heading={4}>
        oss://{oss.bucket}
        <SimpleButton
          style={{ fontSize: 16, fontWeight: 'normal', marginLeft: 40 }}
          onClick={() => clipboard(ossutilCmd).then(() => Notification.success({ title: '已复制到剪贴板', content: ossutilCmd }))}
          content="复制 ossutil 命令"
        />
      </Typography.Title>
      <FileList onChange={setPath} />
    </div>
  );
};
