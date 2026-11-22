// The original figure and every table row share the same pinned experiment data.
export function renderResearchBenchmark({ benchmark, results, esc, external }) {
  const scientific = value => value === null ? "—" : value.toExponential().replace("e-0", "e-");
  const integer = value => value.toLocaleString("en-US");
  const groups = Object.entries(results.runs_by_sequence_limit);
  const order = { AdamW: 0, Muon: 1, Hybrid: 2 };
  const tables = groups.map(([limit, group]) => {
    const runs = [...group.runs].sort((a, b) => order[a.optimizer] - order[b.optimizer] || a.projection_lr - b.projection_lr);
    const rows = runs.map(run => `<tr class="optimizer-${esc(run.optimizer.toLowerCase())}">
      <th scope="row">${run.optimizer === "Muon" ? "纯 Muon" : esc(run.optimizer)}</th>
      <td>${scientific(run.projection_lr)}</td>
      <td class="validation-nll">${run.final_validation_nll.toFixed(5)}</td>
      <td>${run.peak_allocated_gib.toFixed(2)}</td>
      <td>${run.final_training_nll.toFixed(5)}</td>
      <td>${integer(run.trainable_parameters)}</td>
      <td>${scientific(run.aux_lr)}</td>
    </tr>`).join("");
    return `<section class="benchmark-group" aria-labelledby="benchmark-${limit}-title">
      <header class="benchmark-group-heading">
        <h5 id="benchmark-${limit}-title">≤ ${esc(limit)} <small>token</small></h5>
        <span>微调前验证 NLL <b>${runs[0].initial_validation_nll.toFixed(5)}</b></span>
      </header>
      <div class="research-table-wrap benchmark-data-table" tabindex="0" role="region" aria-labelledby="benchmark-${limit}-title">
        <table aria-labelledby="benchmark-${limit}-title"><thead><tr>
          <th scope="col">优化器</th><th scope="col">投影学习率</th><th scope="col">验证 NLL ↓</th>
          <th scope="col">峰值显存 / GiB</th><th scope="col">训练 NLL</th><th scope="col">可训练参数量</th>
          <th scope="col">其余参数学习率</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>
      <p class="benchmark-token-count">监督 token 数 · 训练 ${integer(group.train_supervised_tokens)} / 验证 ${integer(group.validation_supervised_tokens)}</p>
    </section>`;
  }).join("");
  const longest = results.runs_by_sequence_limit["4096"];
  const interval = longest.paired_bootstrap_95pct_hybrid_minus_muon_validation_nll_at_5e_minus_5;
  const comparison = longest.runs.filter(run =>
    run.projection_lr === 3e-5 && ["AdamW", "Hybrid"].includes(run.optimizer)
  );
  return `<div class="research-benchmark" id="research-benchmark">
    <h4 class="benchmark-title">${esc(benchmark.title)}</h4>
    <div class="benchmark-spread">
      <div class="benchmark-brief">
        <p>${esc(benchmark.conditions)}</p>
        <div class="benchmark-callout">
          <p>≤4096 token · 投影学习率 3e-5</p>
          <dl>${comparison.map(run => `<div><dt>${esc(run.optimizer)}</dt><dd>${run.final_validation_nll.toFixed(5)}</dd></div>`).join("")}</dl>
          <small>第 48 步验证 NLL，越低越好</small>
        </div>
      </div>
      <figure class="benchmark-figure">
        <a href="${esc(benchmark.figurePath)}" target="_blank" rel="noopener noreferrer" aria-label="打开英文实验图原图"><img src="${esc(benchmark.figurePath)}" width="1980" height="1468" alt="英文实验图，按 512、2048、4096 token 对照三种优化器的训练曲线与最终验证 NLL。" loading="lazy" decoding="async"></a>
        <figcaption><span>训练曲线取最近 5 步均值，水平虚线表示微调前的验证基线。</span><a href="${esc(benchmark.figurePath)}" target="_blank" rel="noopener noreferrer">查看原图 ↗</a></figcaption>
      </figure>
    </div>
    <div class="benchmark-index"><div><h5>逐组实验结果</h5><p>在同一长度组内比较。纯 Muon 只更新投影矩阵，AdamW 与 Hybrid 更新相同的参数。</p></div>
      <nav class="benchmark-jump-links" aria-label="按长度上限跳转">${groups.map(([limit]) => `<a href="#benchmark-${limit}-title">${esc(limit)} <small>token</small></a>`).join("")}</nav>
    </div>
    ${tables}
    <p class="research-method">${esc(benchmark.note)}</p>
    <details class="about-disclosure benchmark-settings"><summary>实验设置与补充统计 <span>环境 / 数据 / 统计区间</span></summary><dl><div><dt>模型与硬件</dt><dd>${esc(results.model)} · ${esc(results.hardware)}</dd></div><div><dt>运行环境</dt><dd>PyTorch ${esc(results.software.torch)} · Transformers ${esc(results.software.transformers)} · hybrid_muon ${esc(results.software.hybrid_muon)}（实现提交 ${esc(results.software.git)}）</dd></div><div><dt>数据与训练</dt><dd>每组 ${groups[0][1].train_examples} 条训练、${groups[0][1].validation_examples} 条验证，48 次更新，完整问答不截断；FP32 权重、BF16 自动混合精度、视觉编码器冻结、不使用 MTP。固定种子 ${results.seed}。</dd></div><div><dt>优化器设置</dt><dd>Muon scale_mode=${esc(results.settings.muon_scale_mode)}，momentum=${results.settings.muon_momentum}，Newton–Schulz 迭代 ${results.settings.newton_schulz_steps} 次；AdamW betas=(${results.settings.adamw_betas.join(", ")})，eps=${scientific(results.settings.adamw_eps)}。权重衰减：投影 ${results.settings.weight_decay.projection}，其余衰减组 ${results.settings.weight_decay.aux_decay}，无衰减组 ${results.settings.weight_decay.aux_no_decay}。</dd></div><div><dt>计算设置</dt><dd>512 组 batch=2；2048 / 4096 组使用激活检查点，每次更新累积两个单序列微批次；4096 组对输出层损失按 256 token 分块。使用 causal conv 与 gated delta rule 的参考 PyTorch 核。</dd></div><div><dt>数据标识 / SHA-256</dt><dd><code>${esc(results.dataset_sha256)}</code></dd></div><div><dt>4096 组验证样本</dt><dd>共 ${longest.validation_strata.all.examples} 条；≤2048 token 的 ${longest.validation_strata.up_to_2048.examples} 条（${integer(longest.validation_strata.up_to_2048.target_tokens)} 个监督 token），更长的 ${longest.validation_strata.above_2048.examples} 条（${integer(longest.validation_strata.above_2048.target_tokens)} 个监督 token）。</dd></div><div><dt>配对 Bootstrap 95% 区间</dt><dd>4096 组、投影学习率 5e-5，Hybrid − Muon 的验证 NLL 差值区间为 [${interval.map(value => value.toFixed(8)).join(", ")}]，包含 0。</dd></div></dl></details>
    <div class="research-evidence"><a class="text-link" href="${esc(benchmark.dataPath)}" download="qwen3.5-0.8b-results.json">下载全部指标与逐步损失 JSON ↓</a>${external(benchmark.url, "GitHub 原始数据", "text-link")}${external(benchmark.readmeUrl, "项目实验说明", "text-link")}</div></div>`;
}
