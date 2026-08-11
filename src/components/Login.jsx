import { useEffect } from 'react';
import { redirectToSso } from '../api.js';

// SSO 登录页：不再有验证码输入，自动跳转认证中心完成认证
export default function Login() {
  useEffect(() => {
    redirectToSso();
  }, []);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">Admin</div>
        <p className="login-sub">正在跳转认证中心…</p>
        <button className="btn btn-primary" type="button" onClick={redirectToSso}>
          未跳转？点击前往登录
        </button>
      </div>
    </div>
  );
}
