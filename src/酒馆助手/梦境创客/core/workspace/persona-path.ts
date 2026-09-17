import { encodeWorkspaceSegment } from '../mapping/serde';

/** 头像 ID 是宿主的 Persona 主键；可逆编码避免短哈希碰撞，也不依赖显示名称。 */
export function personaWorkspaceStem(name: string, id: string): string {
  const suffix = btoa(String.fromCharCode(...new TextEncoder().encode(id)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
  return `${encodeWorkspaceSegment(name)}--${suffix}`;
}

export function personaWorkspacePath(name: string, id: string, avatar = false): string {
  return `/users/${personaWorkspaceStem(name, id)}${avatar ? '.avatar.png' : '.md'}`;
}
