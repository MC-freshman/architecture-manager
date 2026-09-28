export const PLAN_WRITE_KINDS = [
  'document-edit',
  'resource-pointer',
  'platform-view',
  'registry-edit',
  'integration-config',
  'integration-pointer',
  'integration-registry',
  'software-import'
];

export function friendlyError(error) {
  const code = String(error?.message ?? error);
  const hints = {
    DOCUMENT_BASELINE_MISMATCH: '文档在读取后发生了变化，请重新打开文档再编辑。',
    EXTERNAL_CHANGE_DETECTED: '目标文件已被其他程序修改，管理台已阻止覆盖，请重新扫描。',
    TOP_LEVEL_CONFIRMATION_REQUIRED: '顶层治理文件需要勾选确认后才能生成计划。',
    TARGET_VERSION_UNAVAILABLE: '目标版本不在当前共享仓目录中，请先确认版本已发布。',
    POINTER_BASELINE_REQUIRED: '这个指针缺少基线哈希，请重新扫描工作区。',
    CATALOG_BASELINE_MISMATCH: 'registry 在读取后发生了变化，请重新扫描工作区。',
    CATALOG_ENTRY_ALREADY_EXISTS: '这个条目已经存在，请先查看现有条目。',
    CATALOG_ENTRY_NOT_FOUND: '没有找到这个条目。',
    CATALOG_CURRENT_NOT_FOUND: 'agent 的 current.json 不存在，不能注册。',
    SKILL_CATALOG_NOT_FOUND: '技能目录文件不存在，不能注册。',
    PLATFORM_PATH_OUTSIDE_WORKSPACE: '平台目录必须位于当前工作区内。',
    SOFTWARE_BODY_PATH_NOT_FOUND: '软件配方声明的本体路径不存在。',
    TRANSACTION_TARGET_OUTSIDE_WORKSPACE: '目标路径不在当前工作区内，操作已阻止。',
    TRANSACTION_KIND_UNSUPPORTED: '此类计划暂时只能查看，尚未提供安全执行器。'
  };
  return hints[code] ? `${hints[code]}（${code}）` : code;
}

