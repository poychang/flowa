import { createRoot } from 'react-dom/client';
import './bootstrap';
import { App } from './App';
import '@excalidraw/excalidraw/index.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<App/>);
