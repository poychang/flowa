import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@excalidraw/excalidraw/index.css';
import './style.css';

if (import.meta.env.PROD) window.EXCALIDRAW_ASSET_PATH = '/';

createRoot(document.getElementById('root')!).render(<App/>);
