export const PLAN_WRITE_KINDS = [
  'document-edit',
  'defect-book-edit',
  'resource-pointer',
  'platform-view',
  'registry-edit',
  'integration-config',
  'integration-registry',
  'software-import',
  'software-recipe-publish',
  'software-revert'
];

export function friendlyError(error) {
  const code = String(error?.message ?? error);
  const [key, ...details] = code.split(':');
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
    TRANSACTION_KIND_UNSUPPORTED: '此类计划暂时只能查看，尚未提供安全执行器。',
    RESOURCE_REFERENCED: '仍有现行启用资源引用它，停用或移除已阻止。下方列出全部引用文件',
    NO_CHANGE: '目标版本与当前默认版本相同，无需切换。',
    TARGET_VERSION_NOT_FROZEN: '目标版本缺少发布封条 SHA256SUMS，不能切换。',
    SOFTWARE_CONNECTOR_NOT_CONFIGURED: '所选平台仍未绑定新版软件连接器，请换选已配置的平台或先完成平台接线。',
    INTEGRATION_BASELINE_MISMATCH: '目标在预览后已变化，请重新读取目标再生成计划。',
    DEFECT_BOOK_BASELINE_MISMATCH: '缺陷状态簿在读取后发生了变化，请刷新后再操作。',
    DEFECT_BOOK_NO_CHANGE: '该缺陷已经是这个状态，无需变更。',
    DEFECT_BOOK_ROW_NOT_FOUND: '没有找到这条缺陷，请刷新缺陷簿。',
    DEFECT_BOOK_ROW_EXISTS: '已存在同号缺陷，登记被阻止。',
    DEFECT_BOOK_FIELD_REQUIRED: '登记缺陷缺少必填字段。',
    DEFECT_BOOK_STATUS_INVALID: '非法的缺陷状态取值。',
    DEFECT_BOOK_CORRUPT: '缺陷状态簿不是合法 JSON，操作已阻止。'
  };
  return hints[key] ? `${hints[key]}（${key}）${details.length ? `\n${details.join(':').trim()}` : ''}` : code;
}

