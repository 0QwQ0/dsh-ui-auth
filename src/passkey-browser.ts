/**
 * 登录页（Host 半区渲染的独立页面）使用的 WebAuthn 浏览器端入口。
 *
 * 只做一件事：把成熟社区库 @simplewebauthn/browser 的注册/登录入口暴露为全局 SWA，
 * 供 /auth/login 的内联脚本调用。协议细节（base64url 编解码、clientDataJSON、
 * authenticatorData、错误映射）全部交给该库，插件不重复实现。
 *
 * 该文件被打成 IIFE（globalName: SWA），与 src/client.ts 共享同一个依赖版本，
 * 保证登录页与用户管理页的行为一致。
 */
export { startAuthentication, startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser'
