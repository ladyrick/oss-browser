import '@arco-design/web-react/dist/css/arco.css';

import { useGetLowLevelOssAndPath, useMounted } from './hooks';
import { Login } from './comps/Login';
import { OssBrowser } from './comps/OssBrowser';
import { BrowserRouter } from 'react-router-dom';

const EnsureOssIsSetup: React.FC = () => {
  const { partialOss, initialize } = useGetLowLevelOssAndPath();
  useMounted(initialize);
  if (partialOss.key === undefined || partialOss.secret === undefined || partialOss.endpoint === undefined || partialOss.bucket === undefined)
    return <Login />;

  return <OssBrowser />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <EnsureOssIsSetup />
    </BrowserRouter>
  );
};

export default App;
