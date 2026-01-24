const https = require('https');

class FeishuService {
    constructor() {
        this.appId = process.env.FEISHU_APP_ID;
        this.appSecret = process.env.FEISHU_APP_SECRET;
    }

    /**
     * 发起 HTTPS 请求的辅助方法
     */
    request(options, data) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed.code !== 0) {
                            reject(new Error(`Feishu API Error: ${parsed.msg || 'Unknown error'} (code: ${parsed.code})`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse Feishu response'));
                    }
                });
            });

            req.on('error', (e) => reject(e));

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    /**
     * 获取 app_access_token
     */
    async getAppAccessToken() {
        const options = {
            hostname: 'open.feishu.cn',
            path: '/open-apis/auth/v3/app_access_token/internal',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        const data = {
            app_id: this.appId,
            app_secret: this.appSecret
        };

        const result = await this.request(options, data);
        return result.app_access_token;
    }

    /**
     * 通过 code 换取用户信息 (v1 接口，适用于 H5 应用)
     * result.data 包含 access_token, open_id, user_id, name, avatar_url 等
     */
    async getUserInfo(code, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: '/open-apis/authen/v1/access_token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const data = {
            grant_type: 'authorization_code',
            code: code
        };

        const result = await this.request(options, data);
        return result.data;
    }

    /**
     * 获取用户详细信息 (获取部门 ID)
     * 需要权限: contact:user.base:readonly
     */
    async getUserDetails(userId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/contact/v3/users/${userId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const result = await this.request(options);
        return result.data.user;
    }

    /**
     * 获取部门信息
     * 需要权限: contact:department.base:readonly
     */
    async getDepartmentInfo(departmentId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/contact/v3/departments/${departmentId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const result = await this.request(options);
        return result.data.department;
    }
}

module.exports = new FeishuService();
