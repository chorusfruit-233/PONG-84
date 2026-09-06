# 6.3.0 ASCII 与团队 AI 性能记录

真实 Chromium，禁用 GPU 加速；权威主机控制 3 名 AI，前后阵型，使用生产帧循环及 ASCII DOM 渲染。每组约 3.5 秒，原始结果见 `validation/team_ui.json`。最终采样运行时没有并行比赛基准进程。

| CPU 节流 | 采样长度 | 画面提交次数 | 平均提交间隔 | P95 提交间隔 | Canvas 请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 倍 | 3.503 s | 210 | 16.67 ms | 17.50 ms | 0 |
| 6 倍 | 3.507 s | 211 | 16.66 ms | 22.40 ms | 0 |

该表记录脚本提交，不是实体显示器端到端帧率；短样本不证明任意弱 CPU 都能恒定 60 FPS。原有自适应和 30 帧节能模式保留。GPU 状态的原始查询结果：

```json
{
  "2d_canvas": "disabled_software",
  "direct_rendering_display_compositor": "disabled_off_ok",
  "gpu_compositing": "disabled_software",
  "multiple_raster_threads": "disabled_off",
  "opengl": "disabled_off",
  "rasterization": "disabled_software",
  "raw_draw": "disabled_off_ok",
  "skia_graphite": "disabled_off",
  "trees_in_viz": "disabled_off",
  "video_decode": "disabled_software",
  "video_encode": "disabled_software",
  "vulkan": "disabled_off",
  "webgl": "disabled_off",
  "webgpu": "disabled_off",
  "webnn": "disabled_off"
}
```

## 新 AI 的计算约束

AI 决策仅由当前权威主机计算。观察在约 60 Hz 采样，保留至多 16 个延迟场景；反应间隔 135–162 ms，队内协调间隔 140 ms。瞬态观察不进入迁移快照；恢复后重新建立延迟，而不是读实时落点直接补救。

11 个基础击球偏移加当前位置、可达端点、上次偏移，去重后不超过 15 个候选。仅最优的 3 条候选做代表性回复推演，每条检查 3 个回球角度。轨迹数学计算最多 600 个固定步或 2.5 秒；控制器自身防守展望不超过 1.15 秒。没有无界树搜索、外部模型、图像推理或 GPU 运算。

角色和短程战术反馈有固定大小上界，并由快照校验限制。运动路径按物理步推进，不能通过降低 ASCII 绘制帧率改变移速、碰撞或比分。图形模式继续使用原有 Canvas 光学渲染，不因 AI 限制而改成低画质。

完整对局的加速模拟耗时仅说明执行成本，不作为实时帧率数据。仍需要实体低端设备验证。
