# 0.4.0 重构交付与验收

日期：2026-11-08。修改基于提交 `1187528c5b796a686c57659556dfaecdd2ddfbf9`。

## 审计结论

原调用链：ST 消息/角色卡/世界书/柏宝书 → autoTag/prompt → LLM → protocol.images/changes → charTags 消息增量 → charAnchors 的残余占位符替换 → 正文 bbi_image → floor/Card → generate → NAI/ComfyUI → 图片与侧写保存。

原问题：name 是人物库唯一键；sex 是绘图词而非身份事实；基础/临时外貌混存；outfit 只是整串款式；AI set 可重写本聊天档案；最终提示主要依赖 LLM 照抄；增量只校验 swipe，不校验正文/上游版本。原“素材库”是 Vibe/画师串/图库，没有服装或同人检索服务。

新链路保留原有入口和后端，增加证据校验、身份与衣物事件回放、世界补全、素材版本快照、确定性人物编译、能力覆盖和实际请求追踪。公开第三方接口仍接受调用者提供的提示词，不擅自套用当前聊天的剧情状态。

## 分阶段实现与真实文件

| 阶段 | 文件 | 实际接入行为 |
| --- | --- | --- |
| P0 | state/requestTrace.ts、backends/nai.ts、generationMeta.ts、pages/history/index.vue | fetch 前记录脱敏后的实际 NAI JSON；失败请求在内存历史可见，成功快照随图和侧写保存。 |
| P1 | state/sceneState.ts、sceneStore.ts、charTags.ts、autoTag/protocol.ts、runner.ts | ID/别名/作品索引，身份/女主资格分离，基础/临时形象，穿搭实例/部件/状态，受控事件，人工纠正和撤销，版本保护。 |
| P1 | autoTag/sceneCompiler.ts、st/imageTagRegex.ts、floor/Card.vue | 按原楼层/段落编译，characterId/work 消歧，旧图沿用已保存配方，失效状态明确提示。 |
| P2 | state/visualTypes.ts、visualDesign.ts、visualLibrary.ts | 世界视觉档案，本地人物/服装/画风素材，中文别名/有限简繁归一，世界/类型/作品过滤，款式版本和绑定时快照。 |
| P2/P4 | pages/characters/VisualStudio.vue、autoTag/visualActions.ts | 库内抽样、创作新款、真实生图预览、收藏/应用分离、保留状态或完整换装、定妆、衣物修正、原镜头重编译、撤销、JSON 导入导出。 |
| P3 | backends/capabilities.ts、nai.ts、generate.ts、autoTag/prompt.ts | 代理能力覆盖、单人降级、共享 Vibe 参考、多人参考降级、字符预算/裁剪记录、排队时冻结模型/连接/参考配方、全局画风过滤具体人物特征。 |
| P4 | README.md、本文件、scripts/visual-ui-smoke.py、新增与扩展测试 | 迁移、回滚、验收和浏览器冒烟测试。 |

这些模块均在执行链使用，不是未接线的数据准备。没有新增虚构的网络图库或代理端点。

## 关键行为

- 标签、图片和女性化外貌不证明身份。身份引用必须含人物名，并存在于目标正文或本次实际提供的角色卡/世界书块。静态设定不能重置动态衣物。否定、梦境、伪装、变身等保守处理；冲突保留已确认事实。
- 基础定妆不被自由 changes.set 覆盖。临时形象使用有证据的 appearance 事件；用户可以确认新定妆。视觉设计补全不伪装成剧情事实。
- 不换装就继承。patch 只改已知衣物状态，不能替换设计；放在椅上的衣服不继续作为身上穿着 tag。旧整串无法可靠拆分时保留原文，可人工建立部件。
- 服装、外貌、画风作用域分离。应用保存 materialId/version/scope/materialSeed/effectivePosition/resolved；素材库修改不影响历史绑定。剧情明确换装解除旧服装绑定，保留外貌和画风绑定。
- 仙侠首次未知服装用符合世界的古风设计并持久绑定；已有穿搭和明确现代例外优先。默认发饰只补空白，具体脸型不作为通用画风。
- 库内 roll 不编造预览。创作新款的标签标为未验证，预览走真实 generateImage 与图片上传。收藏不应用；重画不换款；换款改变 materialSeed。
- 楼层、swipe、段落按时间回放。正文/上游事件、身份修正、世界/素材配置、角色卡或输出协议改变时拒绝过期解析。正文与增量经现有 CAS 一起保存，失败一起回滚。
- 编辑旧消息后采用明确重放策略：跳过失效增量并提示，从受影响楼层顺序重新分析。不是后台静默重算。版本前缀滚动扫描，事件线性回放；未引入周期快照缓存。
- 单槽 AI 重写取原槽位置状态，忽略新 changes。单纯重画只用已存 tag 和新的图片 seed。人工应用可不请求 LLM，按每个原镜头位置重编译本楼。

## 实际 NovelAI 能力与降级

现有后端 POST `{endpoint}/ai/generate-image`，body 为 input/model/action/parameters，Authorization 在独立 headers，响应按 ZIP 解图。模型 caption/Vibe 协议沿用仓库已有适配。

接入点可禁用独立人物提示或 Vibe，不能强行开启模型不支持的能力。禁用的参考字段不发送；单人提示可合并降级，多人不把整段外貌合并造成污染，记录原因。按模型组装不等于第三方代理已验证支持，不自动发送收费请求做探测。

人物参考复用现有编码 Vibe，收藏时冻结到独立数据文件或浏览器 IDB，避免原参考改动影响旧素材。跨设备缺少 IDB 数据时降级并记录。单人图可叠加绑定参考，多人跳过人物绑定 Vibe；渠道原有画风参考保留。共享 Vibe 不等于逐人物锁脸，不猜测“导演参考”等未适配字段。

参考操作：先在原 NAI 面板导入/编码图片，再在素材候选选择已编码 Vibe 并收藏，最后套用外貌。原图预览和人物参考是不同用途。

预算为用户配置的字符上限，不冒充精确 tokenizer。先裁掉超量场景尾词并记录；完整人物与衣物状态仍无法容纳时拒绝发送，要求增加预算。seed 只控制随机性，不能保证零漂移。

## 数据兼容、备份和回滚

保留原键：chatMetadata.baibai_image_char_tags（v3）、extra.bbiCharChanges（v1）、extensionSettings.baibai_image_char_global、extra.bbiImage[swipe][promptHash]。不批量删除/覆盖原人物、Vibe、画师串或历史图。人工改名时保留 characterId 和旧名别名。

新增的独立键与附加字段：

- extra.bbiCharChanges.scene：事件、版本、世界/初始设计快照、镜头追踪；首次扩展旧记录时 legacyBackup 保留原始增量。
- chatMetadata.bbi_identity_confirmations_v1：身份/女主资格/别名/作品确认和最近 20 次撤销。
- chatMetadata.bbi_visual_timeline_v1：人工定妆、衣物和素材应用事件，按位置/有效版本回放并支持撤销。
- chatMetadata.bbi_world_visual_v1：世界档案，修改前保留首次备份。
- extensionSettings.bbi_visual_materials_v1：追加素材版本；不改其他库。重复导入已知相同版本幂等，无效导入不落库，未知/损坏格式禁止覆盖。
- extensionSettings.bbi_nai_capabilities_v1：接入点能力覆盖，不含连接或密钥。
- GenerationMeta 的 request/scene/capabilities/warnings/trimmed：兼容附加字段，凭据/连接字段/参考二进制不进入请求追踪。

开发环境没有连接用户实际聊天/设置，没有执行线上迁移或安装。安装前备份酒馆聊天、chatMetadata 和设置，再替换扩展代码/dist 并刷新，先用复制聊天验收。同级 ST-BaiBai-Image-original.zip 为原提交归档。恢复原代码可回滚；旧版本忽略新增键，历史图和旧库保留。

身份和视觉操作有各自撤销按钮；撤销视觉操作后使用“按状态重编译本楼”恢复提示词。原外貌库手动 CRUD 继续沿用原插件的基线接管语义，可能影响历史回放基线，已生成的图片/提示词配方不被暗中改写。

## 自动化验证

```powershell
npm run test -- --silent=true
npm run typecheck
npm run build
```

基线：59 文件、778 项通过、1 项失败、3 项跳过；类型检查缺 @types/node。已补充类型，并将一项后端 thinking 测试与独立 system 提示隔离；未改运行期默认安全规则。最终为 **67 文件通过、838 项通过、3 项既有跳过、无失败**；类型检查和生产构建通过。Vite 的单包超过 500 kB 提示保留，未进行无关拆包改造。

测试断言持久化状态和最终 NAI 请求，不只匹配提示词。新增/扩展覆盖：十段继承、解带、放椅、脸部镜头、古风补全/现代例外、男性保护、同名作品与别名、服装不污染脸、历史模板版本、重画/换款、swipe/旧消息/旧楼层/过期结果、人工确认/撤销、段落绑定与重编译、保存失败回滚、多人隔离、提示预算、真实 fetch JSON 与 mock ZIP、参考数据冻结、预览失败与不伪造图片、日志脱敏、排队配方快照。

UI：Python Playwright + 已安装 Edge，不增加插件运行依赖。启动本地 Vite 5179 后运行 `python scripts/visual-ui-smoke.py`，或由 webapp-testing 的 with_server.py 管理服务。9 项浏览器检查通过：挂载、中文服装查询、换款、收藏不改变剧情、失败无假预览、应用并重编译且身份/发色不变、撤销后重编译、390px 手机布局无横向溢出、浏览器无异常。截图在 .preview/visual-desktop.png 和 visual-mobile.png。UI 模拟 ST 宿主，不等于真实酒馆插件互操作验收。

## 人工验收步骤

1. 写“青云是长发俊美男子”，分析 tag。人物索引应为男性或未知，不因 1girl 进入女主筛选；确认男性后最终请求不能同时有全局 1girl。旧错入库数据在“全部人物”预览后确认男性，可撤销。
2. 写“小雪是女子，穿青色外袍和白色内衫”，后文只“解开外袍系带”，再聊十段无换装剧情。检查同一 outfitInstanceId、outer.fastening=open，内衫和其他状态不变。
3. 写“把外袍放在椅上”，开启 NL；检查 outer.location=on_chair，人物 tag 不含外袍穿着词，NL 有 not worn。镜头只拍脸不能重置衣服。
4. 同楼分段换装生成两图，应分别用前后状态；旧图/单槽重写不能使用后续穿搭。切换 swipe 不继承放弃分支；编辑旧消息后按提示顺序重分析。解析中编辑正文/身份应使旧响应失效。
5. 仙侠卡首次没写衣服应补 hanfu 并建立绑定；明确穿现代 jacket 的穿越者作为例外保留。
6. 在角色管理的新增面板查询“仙侠女剑修服”，应返回合格古风素材；现代世界查 JK 可命中。人物同名先选作品，再选造型版本；无预览必须明确显示无图。
7. 重画候选不换款，收藏不改变剧情；只套服装保留脸和身份。替换款式可保留对应部件状态，完整换装才采用新状态。修改模板后重画/重分析旧楼，绑定版本不应隐改。
8. 选目标楼层、正文位置和人物，确认定妆/部件或套用素材，再重编译本楼；原镜头位置不变、不调用 LLM。撤销后重编译可恢复。
9. 单人绑定参考应在详情显示实际 Vibe；多人跳过人物参考并说明原因。代理不支持时禁用字段；预算不足裁场景或受控报错，不能悄悄删除关键衣物状态。
10. 请求历史/图详情核对实际参数、人物 ID、模板版本、事件证据、状态与降级；不得出现 API Key、Authorization 或参考图二进制。

## 环境与能力边界

- 无可用在线素材 API，因此提供本地索引、真实生图预览和导入，不声称接通在线同人图库。简繁归一为常见字加显式别名，不是全量中文角色知识库；标签验证由用户确认。
- LLM 可能漏报/误解事件，引用校验不能证明语义一定正确。定妆确认和部件修正用于人工接管。旧 raw/outfit 无歧义拆分不了时保留原文，不捏造袖子或位置。
- 不开 NL 时左右袖/离身位置只能近似表达并警告。模型实际绘制可能偏离正确状态/提示词，不能保证零漂移。未实现任务书可选的自动局部修图或图片一致性判图。
- 无真实 ST 会话、NAI 凭据或第三方代理；网络使用 mock，UI 使用模拟宿主。真实协作、付费接口支持、画质需要用户环境验收。
