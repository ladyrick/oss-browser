import {
  Breadcrumb,
  Button,
  Grid,
  Input,
  Message,
  Modal,
  Notification,
  Popconfirm,
  Space,
  Spin,
  Table,
  Typography,
  Upload,
} from '@arco-design/web-react';
import clipboard from '@arco-design/web-react/es/_util/clipboard';
import type { ColumnProps } from '@arco-design/web-react/es/Table';
import { FileList as UploadFileList } from '@arco-design/web-react/es/Upload/list';
import {
  IconEdit,
  IconFile,
  IconFolder,
  IconFolderDelete,
  IconHome,
  IconMinus,
  IconMore,
  IconObliqueLine,
  IconStar,
  IconStarFill,
} from '@arco-design/web-react/icon';
import axios from 'axios';
import moment from 'moment';
import { useEffect, useRef, useState } from 'react';
import { useOssPath, type OssInfo } from '../hooks';
import { SimpleButton } from './SimpleButton';

import { createPortal } from 'react-dom';

const ORIGIN = process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000';

interface FileType {
  name: string;
  key: string;
  size: null | number;
  last_modified: null | number;
}

const naturalSort = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
}).compare;

const defaultNameSorter = (a: FileType, b: FileType) => {
  const a_isdir = a.name.endsWith('/');
  const b_isdir = b.name.endsWith('/');
  if (a_isdir !== b_isdir) {
    return Number(b_isdir) - Number(a_isdir);
  }
  if (a_isdir) {
    // 文件夹排序时，不要把后缀 / 纳入排序
    return naturalSort(a.name.substring(0, a.name.length - 1), b.name.substring(0, b.name.length - 1));
  }
  return naturalSort(a.name, b.name);
};

const renderSize = (size: number) => {
  if (size < 1024) return `${size}`;
  size = size / 1024;
  if (size < 1024) return `${Math.floor(size)} KB`;
  size = size / 1024;
  if (size < 1024) return `${Math.floor(size)} MB`;
  size = size / 1024;
  if (size < 1024) return `${Math.floor(size)} GB`;
  size = size / 1024;
  return `${Math.floor(size)} TB`;
};

const createShareUrl = async (oss: OssInfo, key: string, expire?: number) => {
  const { data } = await axios.post(ORIGIN + '/api/share/', { file_key: key, expire }, { headers: { ...oss } });
  return data.share_url as string;
};

const downloadFile = (url: string, filename: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('target', '_blank');
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

type ModelInfo = {
  mode: 'move' | 'copy';
  visible: boolean;
  root: string;
  srcPaths: string[];
  loading?: boolean;
  targetDir?: string;
  rename?: string;
};

type RenameInfo = {
  visible: boolean;
  file_key: string;
  name: string;
  new_name?: string;
  loading?: boolean;
};

const getLocalConf = (oss: OssInfo) => {
  const s = localStorage.getItem(`${oss.bucket}-${oss.endpoint}`) || '{}';
  try {
    const conf = JSON.parse(s);
    if (Object.prototype.toString.call(conf) === '[object Object]') return conf;
  } catch {
    return {};
  }
  return {};
};
const setLocalConf = (oss: OssInfo, partialConf: object) => {
  const conf = getLocalConf(oss);
  localStorage.setItem(`${oss.bucket}-${oss.endpoint}`, JSON.stringify({ ...conf, ...partialConf }));
};

const getParent = (path: string) => {
  if (!path.includes('/') || !path.slice(0, -1).includes('/')) {
    return '';
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path.slice(0, path.lastIndexOf('/') + 1);
};

const getBasename = (path: string) => {
  if (path.endsWith('/')) {
    return path.split('/').slice(-2)[0] + '/';
  } else {
    return path.split('/').slice(-1)[0];
  }
};

type Props = { root?: string; dirSelectorMode?: boolean; onChange?: (dir: string) => void };
export const FileList: React.FC<Props> = ({ root: initRoot = '', dirSelectorMode = false, onChange }) => {
  const { oss, path: pathOnUrl, setPath: setPathOnUrl } = useOssPath();
  const [innerRoot, setInnerRoot] = useState(dirSelectorMode ? initRoot : pathOnUrl);

  const curDir = dirSelectorMode ? innerRoot : pathOnUrl;
  const setCurDir = dirSelectorMode ? setInnerRoot : setPathOnUrl;

  const [files, setFiles] = useState<FileType[]>();
  const [parent, setParent] = useState<string>(getParent(curDir));
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [counter, setCounter] = useState(0);
  const [, setCounter2] = useState(0);
  const [sortField, setSortField] = useState<string | number>();
  const [sortDirection, setSortDirection] = useState<'ascend' | 'descend'>();
  const [modelInfo, setModelInfo] = useState<ModelInfo>();
  const [renameInfo, setRenameInfo] = useState<RenameInfo>();
  const [editPath, setEditPath] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const limit = useRef<number>(undefined);

  const localConf = getLocalConf(oss);
  const favorites: string[] = Array.from(localConf.favorites || {});

  const [showFavorite, setShowFavorite] = useState(Boolean(localConf.showFavorite));

  const favoriteSpan = 5;
  const uploadFileListRef = useRef<HTMLDivElement | null>(null);

  const addFavorite = (path: string) => {
    if (!favorites.includes(path)) {
      setLocalConf(oss, { favorites: [...favorites, path] });
    }
  };
  const removeFavorite = (path: string) => {
    setLocalConf(oss, { favorites: favorites.filter((f) => f !== path) });
  };

  const updateFull = () => {
    setCounter((c) => (c + 1) % 100000);
  };
  const rerender = () => {
    setCounter2((c) => (c + 1) % 100000);
  };
  const GoUpper: FileType = {
    name: '..',
    key: '',
    size: null,
    last_modified: null,
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.post(
          ORIGIN + '/api/list/',
          {
            path: curDir,
            limit: limit.current,
            dir: dirSelectorMode,
          },
          { headers: { ...oss } },
        );
        setFiles(data.files);
        setParent(data.parent);
        setHasMore(data.has_more);
      } catch (e) {
        if (axios.isAxiosError(e)) {
          Message.error(e.response?.data?.detail || 'oss 不知道哪里有问题！');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [oss, curDir, dirSelectorMode, counter]);

  const sortFunction = (a: FileType, b: FileType) => {
    if (sortDirection) {
      const sign = sortDirection === 'ascend' ? 1 : -1;
      if (sortField === 'name') {
        return sign * defaultNameSorter(a, b);
      }
      if (sortField === 'size') {
        return sign * ((a.size || 0) - (b.size || 0));
      }
      if (sortField === 'last_modified') {
        return sign * ((a.last_modified || 0) - (b.last_modified || 0));
      }
    }
    return defaultNameSorter(a, b);
  };

  const changeRoot = (root: string) => {
    limit.current = undefined;
    setCurDir(root);
    setSelectedRowKeys([]);
    onChange?.(root);
  };

  const columns: ColumnProps<FileType>[] = [
    {
      title: <span style={{ marginLeft: 20 }}>名称</span>,
      dataIndex: 'name',
      render(name: string, record) {
        if (name == '..') {
          return (
            <SimpleButton disabled={curDir === ''} onClick={() => curDir !== '' && changeRoot(parent)} color="magenta">
              <IconFolderDelete style={{ marginRight: 6 }} />
              返回上级
            </SimpleButton>
          );
        }
        if (name.endsWith('/'))
          return (
            <SimpleButton onClick={() => changeRoot(record.key)}>
              <IconFolder style={{ marginRight: 6 }} />
              {name}
            </SimpleButton>
          );
        return (
          <>
            <IconFile style={{ marginRight: 6 }} />
            {name}
          </>
        );
      },
      sorter: true,
      sortOrder: sortField === 'name' ? sortDirection : undefined,
    },
    {
      title: '大小',
      dataIndex: 'size',
      render(size: number | null, record) {
        if (record.name === '..') return '';
        if (size === null) return <IconMinus />;
        return renderSize(size);
      },
      sorter: true,
      sortOrder: sortField === 'size' ? sortDirection : undefined,
    },
    {
      title: '修改时间',
      dataIndex: 'last_modified',
      render(last_modified, record) {
        return record.name === '..' ? '' : last_modified ? moment(last_modified * 1000).format('YYYY-MM-DD HH:mm:ss') : <IconMinus />;
      },
      sorter: true,
      sortOrder: sortField === 'last_modified' ? sortDirection : undefined,
    },
    {
      title: '操作',
      render(_, record) {
        return (
          record.name !== '..' && (
            <Space size="mini">
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  if (favorites.includes(record.key)) {
                    removeFavorite(record.key);
                    Message.info('已取消收藏');
                    rerender();
                  } else {
                    addFavorite(record.key);
                    Message.info('已收藏');
                    rerender();
                  }
                }}
              >
                {favorites.includes(record.key) ? <IconStarFill style={{ color: 'magenta' }} /> : <IconStar style={{ color: 'gray' }} />}
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={async () => {
                  await clipboard(record.key);
                  Message.success({ content: `已复制：${record.key}` });
                }}
              >
                KEY
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  setModelInfo({ mode: 'move', root: curDir, visible: true, srcPaths: [record.key] });
                }}
              >
                移动
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  setModelInfo({ mode: 'copy', root: curDir, visible: true, srcPaths: [record.key] });
                }}
              >
                复制
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  setRenameInfo({ file_key: record.key, name: record.name, visible: true });
                }}
              >
                重命名
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                disabled={record.name.endsWith('/')}
                onClick={async () => {
                  // 考虑了几种预览的方式：
                  // 1. 直接在新窗口打开文件的 share url。这样就跟下载一样了。
                  // 2. 在当前页面，获取文件内容。一方面由于跨域问题，需要一个 proxy，另一方面一次只能预览一个文件。
                  // 3. 在新页面打开一个类似 /api/prewview/<file_key> 的 proxy 链接。二进制文件还是会自动下载。
                  // 4. 在新页面打开 dataurl。url 太长太丑了。
                  // 5. 最终采用了 blob url 的方式。缺点是 ctrl-s 保存时无法识别文件名，而且当前页面关闭后，预览页面也不能再刷新了。
                  try {
                    const rsp = await axios.post(
                      ORIGIN + '/api/preview/',
                      { file_key: record.key },
                      { headers: { ...oss }, responseType: 'arraybuffer' },
                    );
                    const arraybuffer = rsp.data;
                    const blob = new Blob([arraybuffer], { type: rsp.headers['content-type'] });
                    const blobUrl = URL.createObjectURL(blob);
                    window.open(blobUrl, '_blank');
                  } catch (e) {
                    if (axios.isAxiosError(e)) {
                      return void Message.error({ content: new TextDecoder().decode(e.response?.data) });
                    }
                    throw e;
                  }
                }}
              >
                预览
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                disabled={record.name.endsWith('/')}
                onClick={async () => {
                  const url = await createShareUrl(oss, record.key);
                  downloadFile(url, record.name);
                }}
              >
                下载
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                disabled={record.name.endsWith('/')}
                onClick={async () => {
                  const url = await createShareUrl(oss, record.key, 365 * 86400);
                  await clipboard(url);
                  Notification.success({ title: '已复制分享链接，有效期 1 年', content: url });
                }}
              >
                分享
              </Button>
              <Popconfirm
                title="确认删除？"
                onOk={async () => {
                  await axios.post(ORIGIN + '/api/delete/', { src_keys: [record.key] }, { headers: { ...oss } });
                  updateFull();
                }}
              >
                <span>
                  <Button type="text" style={{ height: 'unset', padding: '0 4px', fontSize: 14 }} content="删除" status="danger">
                    删除
                  </Button>
                </span>
              </Popconfirm>
            </Space>
          )
        );
      },
    },
  ];
  if (dirSelectorMode) {
    columns.splice(3, 1);
    columns.splice(1, 1);
  }
  const pathParts = curDir.split('/');

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div style={{ marginTop: dirSelectorMode ? 0 : 10, marginBottom: 10, marginLeft: 5 }}>
          {editPath ? (
            <Input
              style={{ width: '100%' }}
              autoFocus
              defaultValue={curDir}
              onPressEnter={({ target: { value } }) => {
                if (!value.endsWith('/')) value += '/';
                changeRoot(value);
                setEditPath(false);
              }}
              onBlur={({ target: { value } }) => {
                if (value && !value.endsWith('/')) value += '/';
                changeRoot(value);
                setEditPath(false);
              }}
            />
          ) : (
            <Space style={{ height: 32 }}>
              <IconEdit
                key="1"
                style={{ color: 'var(--color-text-3)', fontSize: 16, verticalAlign: 'text-bottom', cursor: 'pointer' }}
                onClick={() => setEditPath(true)}
              />
              <Breadcrumb key="2" style={{ fontSize: 16 }} separator={<IconObliqueLine onClick={() => setEditPath(true)} />}>
                <Breadcrumb.Item>
                  <Button
                    type="text"
                    style={{ height: 'unset', padding: '0 4px', fontSize: 16, color: 'var(--color-text-3)' }}
                    onClick={() => {
                      changeRoot('');
                    }}
                  >
                    <IconHome />
                  </Button>
                </Breadcrumb.Item>
                {pathParts.map((path, i) => (
                  <Breadcrumb.Item key={i}>
                    {i < pathParts.length - 1 ? (
                      <Button
                        type="text"
                        style={{ height: 'unset', padding: '0 4px', fontSize: 16, color: 'var(--color-text-3)' }}
                        onClick={() => changeRoot(pathParts.slice(0, i + 1).join('/') + '/')}
                      >
                        {path}
                      </Button>
                    ) : (
                      <Button
                        type="text"
                        style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                        onClick={() => {
                          if (curDir === '') {
                            Message.error('收藏根目录，图啥呢？');
                          } else if (favorites.includes(curDir)) {
                            removeFavorite(curDir);
                            Message.info('已取消收藏');
                            rerender();
                          } else {
                            addFavorite(curDir);
                            Message.info('已收藏');
                            rerender();
                          }
                        }}
                      >
                        {favorites.includes(curDir) ? <IconStarFill style={{ color: 'magenta' }} /> : <IconStar style={{ color: 'gray' }} />}
                      </Button>
                    )}
                  </Breadcrumb.Item>
                ))}
              </Breadcrumb>
            </Space>
          )}
        </div>

        <Space size="medium">
          <Button
            type="text"
            style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
            key="favorite"
            onClick={() => {
              setLocalConf(oss, { ...localConf, showFavorite: !showFavorite });
              setShowFavorite((s) => !s);
            }}
          >
            {showFavorite ? '隐藏收藏' : '显示收藏'}
          </Button>
          <Button
            type="text"
            disabled={!hasMore}
            style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
            key="more"
            onClick={() => {
              limit.current = 0;
              updateFull();
            }}
          >
            加载全部
          </Button>
          {!dirSelectorMode && (
            <>
              <IconMore />
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  if (selectedRowKeys.length) setModelInfo({ mode: 'move', root: curDir, visible: true, srcPaths: selectedRowKeys });
                  else Message.warning('未选择文件或目录');
                }}
              >
                批量移动
              </Button>
              <Button
                type="text"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  if (selectedRowKeys.length) setModelInfo({ mode: 'copy', root: curDir, visible: true, srcPaths: selectedRowKeys });
                  else Message.warning('未选择文件或目录');
                }}
              >
                批量复制
              </Button>
              <Button
                type="text"
                status="danger"
                style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}
                onClick={() => {
                  if (!selectedRowKeys.length) {
                    Message.warning('未选择文件或目录');
                  } else {
                    Modal.confirm({
                      title: '确认删除？',
                      content: `已选择 ${selectedRowKeys.length} 个项目。请谨慎！尤其是目录，会递归删除！`,
                      async onOk() {
                        await axios.post(ORIGIN + '/api/delete/', { src_keys: selectedRowKeys }, { headers: { ...oss } });
                        updateFull();
                      },
                    });
                  }
                }}
              >
                批量删除
              </Button>
              <div className="upload-wrapper">
                <Upload
                  action={ORIGIN + '/api/upload/'}
                  onChange={(fileList, file) => {
                    if (fileList.map((f) => f.uid).includes(file.uid)) {
                      if (file.status === 'done') {
                        Message.success('上传成功!');
                        updateFull();
                      } else if (file.status === 'error') {
                        Message.error('上传失败!');
                      }
                    }
                  }}
                  headers={{ ...oss }}
                  data={{ path: curDir }}
                  renderUploadList={(fileList, props) => {
                    return (
                      uploadFileListRef.current &&
                      createPortal(
                        <Grid.Row>
                          <Grid.Col style={{ marginTop: -24 }} xxl={12} xl={18} md={24} xs={24}>
                            <UploadFileList fileList={fileList} prefixCls="arco-upload" listType="text" {...props} />
                          </Grid.Col>
                        </Grid.Row>,
                        uploadFileListRef.current,
                      )
                    );
                  }}
                >
                  <Button type="text" style={{ height: 'unset', padding: '0 4px', fontSize: 14 }}>
                    上传文件
                  </Button>
                </Upload>
              </div>
              <Button type="text" style={{ height: 'unset', padding: '0 4px', fontSize: 14 }} onClick={updateFull}>
                刷新
              </Button>
            </>
          )}
        </Space>

        <div ref={uploadFileListRef} />

        <Grid.Row gutter={10}>
          {showFavorite && (
            <Grid.Col span={favoriteSpan}>
              <Table
                style={{ width: '100%' }}
                size="small"
                rowKey="id"
                data={favorites.map((p, i) => ({ id: i + 1, key: p }))}
                columns={[
                  {
                    title: '已收藏对象',
                    dataIndex: 'key',
                    ellipsis: true,
                    render(key) {
                      return (
                        <SimpleButton
                          onClick={() => {
                            if (key.endsWith('/')) {
                              changeRoot(key);
                            } else {
                              changeRoot(getParent(key));
                            }
                          }}
                        >
                          <Typography.Ellipsis showTooltip>{key}</Typography.Ellipsis>
                        </SimpleButton>
                      );
                    },
                  },
                ]}
                pagination={false}
              />
            </Grid.Col>
          )}
          <Grid.Col span={showFavorite ? 24 - favoriteSpan : 24}>
            <Table
              rowKey="key"
              loading={loading}
              columns={columns}
              data={(files === undefined ? [] : [GoUpper]).concat([...(files || [])].sort(sortFunction))}
              pagination={false}
              size="small"
              onChange={(_, sorter) => {
                if (sorter && !Array.isArray(sorter) && sorter.field) {
                  setSortField(sorter.field);
                  setSortDirection(sorter.direction);
                }
              }}
              rowSelection={
                !dirSelectorMode
                  ? {
                      type: 'checkbox',
                      selectedRowKeys,
                      onChange: (selectedRowKeys) => {
                        setSelectedRowKeys(selectedRowKeys as string[]);
                      },
                      checkboxProps: (record) => {
                        return record.key === ''
                          ? {
                              style: { display: 'none' },
                              disabled: true,
                            }
                          : {};
                      },
                    }
                  : undefined
              }
            />
          </Grid.Col>
        </Grid.Row>
      </Space>
      {!dirSelectorMode && modelInfo?.visible && (
        <Modal
          title={
            modelInfo.mode === 'move'
              ? modelInfo.srcPaths.length == 1
                ? `移动${modelInfo.srcPaths[0].endsWith('/') ? '目录' : '文件'} ${getBasename(modelInfo.srcPaths[0])} 到`
                : `移动 ${modelInfo.srcPaths.length} 个文件/目录到`
              : modelInfo.srcPaths.length == 1
                ? `复制${modelInfo.srcPaths[0].endsWith('/') ? '目录' : '文件'} ${getBasename(modelInfo.srcPaths[0])} 到`
                : `复制 ${modelInfo.srcPaths.length} 个文件/目录到`
          }
          visible={modelInfo.visible}
          onOk={async () => {
            if ((modelInfo.targetDir !== undefined && modelInfo.targetDir !== curDir) || modelInfo.rename) {
              if (modelInfo.srcPaths.length == 1 && modelInfo.rename !== undefined && modelInfo.rename.includes('/')) {
                if (modelInfo.srcPaths[0].endsWith('/')) {
                  if (modelInfo.rename.indexOf('/') !== modelInfo.rename.length - 1) {
                    Message.error('新名称无效，除非位于末尾，否则 / 无法用于目录名！');
                    return;
                  }
                } else {
                  Message.error('新名称无效，/ 无法用于文件名！');
                  return;
                }
              }

              setModelInfo({ ...modelInfo, loading: true });
              try {
                await axios.post(
                  ORIGIN + `/api/${modelInfo.mode}/`,
                  {
                    src_keys: modelInfo.srcPaths,
                    target_dir: modelInfo.targetDir || modelInfo.root,
                    rename: modelInfo.srcPaths.length === 1 ? modelInfo.rename || undefined : undefined,
                  },
                  { headers: { ...oss } },
                );
                Message.success((modelInfo.mode === 'move' ? '移动' : '复制') + '文件成功！');
                updateFull();
              } catch {
                Message.error((modelInfo.mode === 'move' ? '移动' : '复制') + '文件失败！');
              }
            } else {
              Message.warning('源文件夹跟目标文件夹为同一文件夹！');
              return;
            }
            setModelInfo(undefined);
          }}
          onCancel={() => setModelInfo(undefined)}
          style={{ width: '50%' }}
        >
          <Spin loading={modelInfo.loading} style={{ width: '100%' }}>
            <FileList
              root={modelInfo.root}
              dirSelectorMode
              onChange={(dir) => {
                setModelInfo({ ...modelInfo, targetDir: dir });
              }}
            />
            <Grid.Row gutter={8} style={{ marginTop: 15 }}>
              <Grid.Col span={5}>
                <div style={{ lineHeight: '32px', textAlign: 'right' }}>同时重命名为：</div>
              </Grid.Col>
              <Grid.Col span={19}>
                <Input
                  disabled={modelInfo.srcPaths.length !== 1}
                  placeholder={getBasename(modelInfo.srcPaths[0])}
                  onChange={(value) => {
                    setModelInfo({ ...modelInfo, rename: value || undefined });
                  }}
                />
              </Grid.Col>
            </Grid.Row>
          </Spin>
        </Modal>
      )}
      {!dirSelectorMode && renameInfo?.visible && (
        <Modal
          title={`重命名：${renameInfo.name}`}
          visible={renameInfo.visible}
          onOk={async () => {
            if (renameInfo.name === renameInfo.new_name) {
              Message.error('新名称跟当前名称相同！');
              return;
            }
            if (!renameInfo.new_name) {
              Message.warning('禁止重命名为空字符串，你把握不住');
              return;
            }
            setRenameInfo({ ...renameInfo, loading: true });
            try {
              console.log(renameInfo);
              await axios.post(
                ORIGIN + `/api/rename/`,
                {
                  file_key: renameInfo.file_key,
                  new_name: renameInfo.new_name || '',
                },
                { headers: { ...oss } },
              );
              Message.success('重命名成功！');
              updateFull();
            } catch {
              Message.error('重命名失败！');
            }
            setRenameInfo({ ...renameInfo, visible: false, loading: false });
          }}
          onCancel={() => setRenameInfo({ ...renameInfo, visible: false, loading: false })}
        >
          <Spin loading={renameInfo.loading} style={{ width: '100%' }}>
            <Input
              placeholder={renameInfo.name}
              onChange={(new_name) => {
                setRenameInfo({ ...renameInfo, new_name });
              }}
            />
          </Spin>
        </Modal>
      )}
    </div>
  );
};
