import { useState } from 'react';
import { getToken } from './api.js';
import Login from './components/Login.jsx';
import Main from './components/Main.jsx';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <Main />;
}
