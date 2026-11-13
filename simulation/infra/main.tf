# PLAN ONLY. Never run terraform apply without pricing, IAM, VPC, data, and operator approval.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
provider "aws" { region = "eu-north-1" }

variable "deploy" {
  type = bool
  default = false
}
variable "lambda_zip_path" {
  type = string
  default = "../out/lambda.zip"
}
variable "secret_arn" {
  type = string
  default = ""
  sensitive = true
}
variable "subnet_ids" {
  type = list(string)
  default = []
}
variable "security_group_ids" {
  type = list(string)
  default = []
}
variable "daily_max_orders" {
  type = number
  default = 16
}
variable "create_alarms" {
  type = bool
  default = false
}

locals { n = var.deploy ? 1 : 0 }
resource "aws_iam_role" "lambda" {
  count = local.n
  name = "fixer-sim-lambda-role"
  assume_role_policy = jsonencode({Version="2012-10-17", Statement=[{
    Effect="Allow", Principal={Service="lambda.amazonaws.com"}, Action="sts:AssumeRole"}]})
}
resource "aws_iam_role_policy_attachment" "vpc" {
  count = local.n
  role = aws_iam_role.lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}
resource "aws_iam_role_policy" "secrets" {
  count = local.n
  role = aws_iam_role.lambda[0].id
  policy = jsonencode({Version="2012-10-17",Statement=[{
    Effect="Allow",Action=["secretsmanager:GetSecretValue"],Resource=var.secret_arn}]})
}
resource "aws_lambda_function" "generator" {
  count = local.n
  function_name = "fixer-sim-generator"
  handler = "runtime.lambda_handler.handler"
  runtime = "python3.12"
  architectures = ["arm64"]
  role = aws_iam_role.lambda[0].arn
  filename = var.lambda_zip_path
  source_code_hash = var.deploy ? filebase64sha256(var.lambda_zip_path) : null
  timeout = 90
  memory_size = 256
  reserved_concurrent_executions = 1
  vpc_config {
    subnet_ids = var.subnet_ids
    security_group_ids = var.security_group_ids
  }
  environment { variables = {
    SIM_LAMBDA_ENABLED = "false"
    SIM_SECRET_ID = var.secret_arn
    SIMULATION_WRITES_APPROVED = "NO"
    SIM_MAX_ORDERS = tostring(var.daily_max_orders)
  } }
  lifecycle { precondition { condition = length(var.subnet_ids)>=2 && length(var.security_group_ids)>=1 && length(var.secret_arn)>10
    error_message = "Approved private subnets, source security group and Secrets Manager ARN required." } }
}
resource "aws_lambda_function" "cdc" {
  count = local.n
  function_name = "fixer-sim-cdc"
  handler = "runtime.lambda_handler.handler"
  runtime = "python3.12"
  architectures = ["arm64"]
  role = aws_iam_role.lambda[0].arn
  filename = var.lambda_zip_path
  source_code_hash = var.deploy ? filebase64sha256(var.lambda_zip_path) : null
  timeout = 90
  memory_size = 256
  reserved_concurrent_executions = 1
  vpc_config {
    subnet_ids = var.subnet_ids
    security_group_ids = var.security_group_ids
  }
  environment { variables = {
    SIM_LAMBDA_ENABLED = "false"
    SIM_SECRET_ID = var.secret_arn
    SIM_CDC_ENABLED = "false"
    SIM_CDC_MAX_EVENTS = "200"
    SIM_CDC_MAX_SECONDS = "40"
  } }
}
resource "aws_iam_role" "scheduler" {
  count = local.n
  name = "fixer-sim-scheduler-role"
  assume_role_policy = jsonencode({Version="2012-10-17",Statement=[{
    Effect="Allow",Principal={Service="scheduler.amazonaws.com"},Action="sts:AssumeRole"}]})
}
resource "aws_iam_role_policy" "invoke" {
  count = local.n
  role = aws_iam_role.scheduler[0].id
  policy = jsonencode({Version="2012-10-17",Statement=[{
    Effect="Allow",Action="lambda:InvokeFunction",
    Resource=[aws_lambda_function.generator[0].arn,aws_lambda_function.cdc[0].arn]}]})
}
resource "aws_scheduler_schedule" "generator" {
  count = local.n
  name = "fixer-sim-generator-jhb"
  state = "DISABLED"
  schedule_expression = "cron(0 8,12,17 * * ? *)"
  schedule_expression_timezone = "Africa/Johannesburg"
  flexible_time_window { mode = "OFF" }
  target {
    arn = aws_lambda_function.generator[0].arn
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({mode="generate",scheduled_time="<aws.scheduler.scheduled-time>"})
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts = 2
    }
  }
}
resource "aws_scheduler_schedule" "cdc" {
  count = local.n
  name = "fixer-sim-cdc-jhb"
  state = "DISABLED"
  schedule_expression = "rate(1 minute)"
  flexible_time_window { mode = "OFF" }
  target {
    arn = aws_lambda_function.cdc[0].arn
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({mode="cdc"})
    retry_policy {
      maximum_event_age_in_seconds = 120
      maximum_retry_attempts = 1
    }
  }
}
resource "aws_cloudwatch_log_group" "generator" {
  count = local.n
  name = "/aws/lambda/fixer-sim-generator"
  retention_in_days = 7
}
resource "aws_cloudwatch_log_group" "cdc" {
  count = local.n
  name = "/aws/lambda/fixer-sim-cdc"
  retention_in_days = 7
}
resource "aws_cloudwatch_metric_alarm" "generator_errors" {
  count = var.deploy && var.create_alarms ? 1 : 0
  alarm_name="fixer-sim-generator-errors"
  namespace="AWS/Lambda"
  metric_name="Errors"
  statistic="Sum"
  period=300
  evaluation_periods=1
  threshold=0
  comparison_operator="GreaterThanThreshold"
  dimensions={FunctionName=aws_lambda_function.generator[0].function_name}
  treat_missing_data="notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "cdc_errors" {
  count = var.deploy && var.create_alarms ? 1 : 0
  alarm_name="fixer-sim-cdc-errors"
  namespace="AWS/Lambda"
  metric_name="Errors"
  statistic="Sum"
  period=300
  evaluation_periods=1
  threshold=0
  comparison_operator="GreaterThanThreshold"
  dimensions={FunctionName=aws_lambda_function.cdc[0].function_name}
  treat_missing_data="notBreaching"
}
