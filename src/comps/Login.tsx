import { Button, Form, Grid, Input, Typography } from '@arco-design/web-react';
import { useGetLowLevelOssAndPath, type OssInfo } from '../hooks';

export const Login: React.FC = () => {
  const { partialOss, setOssInfo } = useGetLowLevelOssAndPath();
  const [form] = Form.useForm<OssInfo>();
  const labelCol = 5;
  const labelProps = {
    labelCol: { span: labelCol },
    wrapperCol: { span: 24 - labelCol },
  };
  return (
    <Grid.Row style={{ marginTop: 200 }}>
      <Grid.Col span={10} offset={7}>
        <Grid.Row>
          <Grid.Col offset={labelProps.labelCol.span}>
            <Typography.Title heading={3}>设置 oss 基本信息</Typography.Title>
            <div style={{ marginBottom: 10 }}>oss 信息仅保存于 url 中，不会保存于后端。</div>
          </Grid.Col>
        </Grid.Row>
      </Grid.Col>
      <Grid.Col span={10} offset={7}>
        <Form
          form={form}
          initialValues={partialOss}
          onSubmit={(value) => {
            setOssInfo(value);
          }}
        >
          <Form.Item {...labelProps} label="key" field="key" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>
          <Form.Item {...labelProps} label="secret" field="secret" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>
          <Form.Item {...labelProps} label="endpoint" field="endpoint" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>
          <Form.Item {...labelProps} label="bucket" field="bucket" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>
          <Form.Item {...labelProps} label=" ">
            <Button type="primary" htmlType="submit">
              确 定
            </Button>
          </Form.Item>
        </Form>
      </Grid.Col>
    </Grid.Row>
  );
};
