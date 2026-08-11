import { describe,expect,it } from 'vitest';
import { createSession,parseSession } from './session.js';

describe('admin session',()=>{
 it('tạo và xác minh session có CSRF',()=>{const raw=createSession('test-secret'),s=parseSession(`ggpay_admin=${raw}`,'test-secret');expect(s?.csrf).toMatch(/^[A-Za-z0-9_-]+$/);});
 it('từ chối cookie bị sửa',()=>{const raw=createSession('test-secret');expect(parseSession(`ggpay_admin=${raw}x`,'test-secret')).toBeNull();});
});
