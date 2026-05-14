use super::*;

#[tauri::command]
pub(crate) async fn pi_optimize_prompt_keywords(input: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || pi_optimize_prompt_keywords_blocking(input, model, provider, thinking_level))
        .await
        .map_err(|error| format!("prompt optimize task failed: {error}"))?
}

fn pi_optimize_prompt_keywords_blocking(input: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<Vec<String>> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("input is required".to_string());
    }

    let system = "你是 AI 编程 Agent 的提示词优化器。请把用户输入的关键词/短句扩展为 3 个明显不同的中文提示词选项，并严格返回 JSON 字符串数组。不要返回 markdown、编号或解释。";
    let user = format!(
        "原始输入：\n{trimmed}\n\n要求：\n1. 选项一：简洁直接，适合快速发送。\n2. 选项二：结构化，明确目标、约束和验收标准。\n3. 选项三：探索增强，补充边界情况、替代方案或风险点。\n4. 三个选项必须互相有明显区分，但都保留原始意图。\n5. 只返回 JSON 数组，例如：[\"...\",\"...\",\"...\"]"
    );

    let raw = call_prompt_optimizer(model, provider, thinking_level, system, &user)?;
    let options = parse_prompt_options(&raw);
    if options.is_empty() {
        return Err("model returned no prompt options".to_string());
    }
    Ok(ensure_three_options(options, trimmed))
}

fn call_prompt_optimizer(model: Option<String>, provider: Option<String>, thinking_level: Option<String>, system: &str, user: &str) -> RpcResult<String> {
    let config = resolve_commit_model_config(model, provider, thinking_level)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))?;

    match config.api.as_str() {
        "anthropic-messages" => call_anthropic_messages(&client, &config, system, user),
        "google-generative-ai" => call_google_generate_content(&client, &config, system, user),
        "openai-responses" => call_openai_responses(&client, &config, system, user),
        "openai-completions" | "openai-chat-completions" | "openai" => call_openai_chat_completions(&client, &config, system, user),
        other => Err(format!("unsupported prompt optimizer model api: {other}")),
    }
}

fn parse_prompt_options(output: &str) -> Vec<String> {
    let trimmed = strip_code_fence(output.trim());
    if let Ok(values) = serde_json::from_str::<Vec<String>>(trimmed) {
        return values.into_iter().filter_map(clean_prompt_option).collect();
    }
    if let Some((start, end)) = trimmed.find('[').zip(trimmed.rfind(']')) {
        if start < end {
            if let Ok(values) = serde_json::from_str::<Vec<String>>(&trimmed[start..=end]) {
                return values.into_iter().filter_map(clean_prompt_option).collect();
            }
        }
    }
    trimmed
        .lines()
        .filter_map(|line| {
            let cleaned = line
                .trim()
                .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '*' || ch == '、')
                .trim()
                .trim_matches(|ch| ch == '"' || ch == '\'' || ch == '`' || ch == ',' || ch == '[' || ch == ']')
                .to_string();
            clean_prompt_option(cleaned)
        })
        .collect()
}

fn strip_code_fence(value: &str) -> &str {
    value
        .strip_prefix("```json")
        .or_else(|| value.strip_prefix("```"))
        .unwrap_or(value)
        .trim_end_matches("```")
        .trim()
}

fn clean_prompt_option(value: String) -> Option<String> {
    let cleaned = value.trim().trim_matches(|ch| ch == '"' || ch == '\'' || ch == '`').to_string();
    if cleaned.is_empty() || cleaned.starts_with("```") {
        return None;
    }
    Some(cleaned.chars().take(500).collect())
}

fn ensure_three_options(mut options: Vec<String>, original: &str) -> Vec<String> {
    options.dedup();
    if options.len() < 3 {
        options.push(format!("请基于「{original}」直接完成实现，保持改动聚焦，并说明关键修改点。"));
    }
    if options.len() < 3 {
        options.push(format!("请将「{original}」拆解为目标、约束和验收标准后再实现，注意与现有 UI/代码风格保持一致。"));
    }
    if options.len() < 3 {
        options.push(format!("请围绕「{original}」给出更完善的实现方案，同时考虑边界情况、错误处理和后续可扩展性。"));
    }
    options.into_iter().take(3).collect()
}
