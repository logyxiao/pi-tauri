use super::*;

#[tauri::command]
pub(crate) async fn pi_fetch_provider_models(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<Vec<String>> {
    fetch_provider_models_with_options(base_url, api_key, headers, auth_header).await.map(|result| result.models)
}

#[tauri::command]
pub(crate) async fn pi_test_provider(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<serde_json::Value> {
    let started = Instant::now();
    let result = fetch_provider_models_with_options(base_url, api_key, headers, auth_header).await?;
    Ok(serde_json::json!({
        "status": "ok",
        "modelCount": result.models.len(),
        "url": result.url,
        "latencyMs": started.elapsed().as_millis() as u64,
        "detail": "provider URL and credentials can access model list"
    }))
}

pub(crate) async fn fetch_provider_models_with_options(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<ProviderModelsResult> {
    let client = reqwest::Client::new();
    let key = resolve_optional_secret(api_key)?;
    let resolved_headers = resolve_provider_headers(headers)?;
    let use_auth_header = auth_header.unwrap_or(true);
    let urls = model_list_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let request = provider_get_request(&client, &url, key.as_deref(), &resolved_headers, use_auth_header);
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("{url}: request failed: {error}");
                continue;
            }
        };
        let status = response.status();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                last_error = format!("{url}: failed to read response: {error}");
                continue;
            }
        };
        if !status.is_success() {
            last_error = format!("{url}: request failed: {status}: {}", body.chars().take(240).collect::<String>());
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                let starts = body.chars().take(240).collect::<String>();
                last_error = format!("{url}: response is not JSON: {error}; starts with: {starts}");
                continue;
            }
        };
        let mut models = Vec::<String>::new();
        collect_model_ids(value.get("data"), &mut models);
        collect_model_ids(value.get("models"), &mut models);
        if models.is_empty() {
            last_error = format!("{url}: JSON parsed but no models found");
            continue;
        }
        models.sort();
        models.dedup();
        return Ok(ProviderModelsResult { models, url });
    }

    Err(format!("failed to fetch models. Tried /models, /v1/models, /api/v1/models. Last error: {last_error}"))
}

#[tauri::command]
pub(crate) async fn pi_probe_provider(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>, balance_base_url: Option<String>, balance_api_key: Option<String>) -> RpcResult<serde_json::Value> {
    let key = resolve_optional_secret(api_key.clone())?;
    let balance_key = resolve_optional_secret(balance_api_key.clone())?.or_else(|| key.clone());
    let resolved_headers = resolve_provider_headers(headers.clone())?;
    let use_auth_header = auth_header.unwrap_or(true);
    let models_result = fetch_provider_models_with_options(base_url.clone(), api_key, headers, auth_header).await;
    let model_count = models_result.as_ref().map(|models| models.len()).unwrap_or(0);
    let models_error = models_result.as_ref().err().cloned();

    let client = reqwest::Client::new();
    let mut balance_error = String::new();
    let balance_base = balance_base_url.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(base_url.as_str());
    for url in provider_balance_urls(balance_base) {
        let request = provider_get_request(&client, &url, balance_key.as_deref(), &resolved_headers, use_auth_header);
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                balance_error = format!("{url}: request failed: {error}");
                continue;
            }
        };
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            balance_error = format!("{url}: request failed: {status}: {}", body.chars().take(240).collect::<String>());
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                balance_error = format!("{url}: response is not JSON: {error}");
                continue;
            }
        };
        if let Some(summary) = summarize_provider_balance(&value) {
            return Ok(serde_json::json!({
                "status": "ok",
                "modelCount": model_count,
                "balance": summary,
                "balanceSource": url,
                "detail": "provider model endpoint and balance endpoint responded"
            }));
        }
        balance_error = format!("{url}: JSON parsed but no balance/quota field recognized");
    }

    if models_result.is_ok() {
        return Ok(serde_json::json!({
            "status": "ok",
            "modelCount": model_count,
            "detail": if balance_error.is_empty() { "provider model endpoint responded; no balance endpoint detected" } else { balance_error.as_str() }
        }));
    }

    Err(format!(
        "provider probe failed. models: {}; balance: {}",
        models_error.unwrap_or_else(|| "unknown model error".to_string()),
        if balance_error.is_empty() { "no balance endpoint detected".to_string() } else { balance_error },
    ))
}

#[tauri::command]
pub(crate) async fn pi_probe_configured_provider(provider_id: String) -> RpcResult<serde_json::Value> {
    let models_json = read_models_json()?;
    let providers = models_json.get("providers").and_then(|value| value.as_object()).ok_or("models.json providers not found")?;
    let provider = providers.get(&provider_id).ok_or_else(|| format!("provider '{provider_id}' not found in models.json"))?;
    let base_url = provider.get("baseUrl").and_then(|value| value.as_str()).ok_or_else(|| format!("provider '{provider_id}' missing baseUrl"))?.to_string();
    let api_key = provider.get("apiKey").and_then(|value| value.as_str()).map(str::to_string);
    let headers = provider
        .get("headers")
        .and_then(|value| value.as_object())
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string())))
                .collect::<HashMap<_, _>>()
        });
    let auth_header = provider.get("authHeader").and_then(|value| value.as_bool());
    let balance_base_url = provider.get("balanceBaseUrl").and_then(|value| value.as_str()).map(str::to_string);
    let balance_api_key = provider.get("balanceApiKey").and_then(|value| value.as_str()).map(str::to_string);
    pi_probe_provider(base_url, api_key, headers, auth_header, balance_base_url, balance_api_key).await
}

struct ProviderModelsResult {
    models: Vec<String>,
    url: String,
}

impl ProviderModelsResult {
    fn len(&self) -> usize {
        self.models.len()
    }
}

pub(crate) fn resolve_optional_secret(value: Option<String>) -> RpcResult<Option<String>> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(resolve_secret_value)
        .transpose()
}

pub(crate) fn resolve_provider_headers(headers: Option<HashMap<String, String>>) -> RpcResult<HashMap<String, String>> {
    let mut resolved = HashMap::new();
    for (key, value) in headers.unwrap_or_default() {
        if key.trim().is_empty() {
            continue;
        }
        resolved.insert(key, resolve_secret_value(&value)?);
    }
    Ok(resolved)
}

pub(crate) fn provider_get_request(client: &reqwest::Client, url: &str, api_key: Option<&str>, headers: &HashMap<String, String>, auth_header: bool) -> reqwest::RequestBuilder {
    let mut request = client
        .get(url)
        .header("accept", "application/json")
        .header("user-agent", "cc-switch/1.0");
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if auth_header {
        if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
            request = request.bearer_auth(key);
        }
    }
    request
}

pub(crate) fn model_list_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut urls = vec![format!("{trimmed}/models")];
    if !trimmed.ends_with("/v1") {
        urls.push(format!("{trimmed}/v1/models"));
    }
    if !trimmed.ends_with("/api/v1") {
        urls.push(format!("{trimmed}/api/v1/models"));
    }
    urls.sort();
    urls.dedup();
    urls
}

pub(crate) fn provider_balance_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut root = trimmed.to_string();
    for suffix in ["/api/v1", "/v1"] {
        if root.ends_with(suffix) {
            root.truncate(root.len() - suffix.len());
            break;
        }
    }
    let mut urls = Vec::new();
    for base in [root.as_str(), trimmed] {
        for suffix in [
            "/dashboard/billing/credit_grants",
            "/v1/dashboard/billing/credit_grants",
            "/api/v1/dashboard/billing/credit_grants",
            "/user/balance",
            "/v1/user/balance",
            "/api/v1/user/balance",
            "/api/user/self",
            "/v1/api/user/self",
            "/api/v1/api/user/self",
            "/usage",
            "/v1/usage",
            "/api/v1/usage",
            "/credits",
            "/v1/credits",
            "/api/v1/credits",
        ] {
            urls.push(format!("{base}{suffix}"));
        }
    }
    urls.sort();
    urls.dedup();
    urls
}

pub(crate) fn summarize_provider_balance(value: &serde_json::Value) -> Option<String> {
    if let Some(summary) = summarize_quota_balance(value) {
        return Some(summary);
    }

    if let Some(quota) = value.get("quota").filter(|item| item.is_object()) {
        if let Some(summary) = summarize_provider_balance(quota) {
            return Some(summary);
        }
    }

    let unit = value.get("unit").and_then(|item| item.as_str()).unwrap_or("USD");
    for key in [
        "total_available",
        "remaining",
        "remain",
        "available",
        "balance",
        "amount",
        "credit",
        "credits",
        "quota",
        "hard_limit_usd",
        "soft_limit_usd",
        "used_quota",
        "total_granted",
        "total_used",
    ] {
        if let Some(summary) = balance_number_or_string(value.get(key), unit) {
            return Some(format!("{key}: {summary}"));
        }
    }

    if let Some(data) = value.get("data") {
        if let Some(summary) = summarize_provider_balance(data) {
            return Some(summary);
        }
    }

    if let Some(object) = value.as_object() {
        let pairs = object
            .iter()
            .filter_map(|(key, value)| json_number_or_string(Some(value)).map(|summary| format!("{key}: {summary}")))
            .take(3)
            .collect::<Vec<_>>();
        if !pairs.is_empty() {
            return Some(pairs.join(" · "));
        }
    }

    None
}

pub(crate) fn summarize_quota_balance(value: &serde_json::Value) -> Option<String> {
    let quota = json_number_value(value.get("quota"));
    let used_quota = json_number_value(value.get("used_quota").or_else(|| value.get("usedQuota")));
    let total_quota = json_number_value(value.get("total_quota").or_else(|| value.get("totalQuota")));
    match (quota, used_quota, total_quota) {
        (Some(quota), Some(used), _) => Some(format!("remaining: {} · used: {}", format_quota_value(quota), format_quota_value(used))),
        (Some(quota), None, Some(total)) => Some(format!("remaining: {} · total: {}", format_quota_value(quota), format_quota_value(total))),
        _ => None,
    }
}

pub(crate) fn json_number_value(value: Option<&serde_json::Value>) -> Option<f64> {
    let value = value?;
    value.as_f64().or_else(|| value.as_str()?.trim().parse::<f64>().ok())
}

pub(crate) fn format_quota_value(value: f64) -> String {
    if value.abs() >= 10_000.0 {
        return format!("{} USD", format_compact_number(value / 500_000.0));
    }
    format!("{} USD", format_compact_number(value))
}

pub(crate) fn format_compact_number(value: f64) -> String {
    format!("{value:.1}")
}

pub(crate) fn json_number_or_string(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(number) = value.as_f64() {
        let formatted = format!("{number:.4}");
        let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
        return Some(if trimmed.is_empty() { "0".to_string() } else { trimmed.to_string() });
    }
    value.as_str().filter(|item| !item.trim().is_empty()).map(str::to_string)
}

pub(crate) fn balance_number_or_string(value: Option<&serde_json::Value>, unit: &str) -> Option<String> {
    let value = value?;
    if let Some(number) = value.as_f64() {
        return Some(format!("{} {}", format_compact_number(number), normalize_balance_unit(unit)));
    }
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    if text.chars().any(|ch| ch.is_ascii_alphabetic() || ch == '$' || ch == '¥' || ch == '€' || ch == '￥') {
        Some(text.to_string())
    } else {
        Some(format!("{text} {}", normalize_balance_unit(unit)))
    }
}

pub(crate) fn normalize_balance_unit(unit: &str) -> &str {
    let trimmed = unit.trim();
    if trimmed.is_empty() { "USD" } else { trimmed }
}

pub(crate) fn collect_model_ids(value: Option<&serde_json::Value>, output: &mut Vec<String>) {
    let Some(serde_json::Value::Array(items)) = value else {
        return;
    };
    for item in items {
        if let Some(id) = item.as_str() {
            output.push(id.to_string());
            continue;
        }
        let id = item
            .get("id")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("model"))
            .and_then(|value| value.as_str());
        if let Some(id) = id.filter(|id| !id.trim().is_empty()) {
            output.push(id.trim().to_string());
        }
    }
}

