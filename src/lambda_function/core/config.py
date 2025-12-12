
import boto3
import yaml
from botocore.exceptions import ClientError
from functools import lru_cache
from typing import Dict, Any
from src.lambda_function.utils.logger import setup_logger

# Setup module logger
logger = setup_logger(__name__)

class ConfigError(Exception):
    """Base exception for configuration errors."""
    pass

class ParameterNotFoundError(ConfigError):
    """Raised when the SSM parameter is not found."""
    pass

class ConfigValidationError(ConfigError):
    """Raised when the configuration is missing required fields or is invalid."""
    pass

@lru_cache(maxsize=128)
def load_config_from_ssm(parameter_name: str) -> Dict[str, Any]:
    """
    Loads configuration from an AWS SSM parameter.

    Args:
        parameter_name: The name of the SSM parameter.

    Returns:
        A dictionary containing the configuration.

    Raises:
        ParameterNotFoundError: If the parameter is not found.
        ConfigError: If the configuration is invalid.
        ConfigValidationError: If required fields are missing.
    """
    logger.info(f"Loading config from SSM: {parameter_name}")

    ssm_client = boto3.client('ssm')

    try:
        response = ssm_client.get_parameter(Name=parameter_name)
        parameter_value = response['Parameter']['Value']
    except ClientError as e:
        if e.response['Error']['Code'] == 'ParameterNotFound':
            raise ParameterNotFoundError(
                f"Could not find SSM parameter: {parameter_name}"
            ) from e
        raise ConfigError(f"Failed to retrieve SSM parameter: {str(e)}") from e

    try:
        config = yaml.safe_load(parameter_value)
    except yaml.YAMLError as e:
        raise ConfigError(
            f"Failed to parse YAML configuration from parameter {parameter_name}: {str(e)}"
        ) from e

    # Validate required fields
    required_fields = ['version', 'environment', 'discovery']
    for field in required_fields:
        if field not in config:
            raise ConfigValidationError(
                f"Missing required field: '{field}' in configuration"
            )

    logger.info("Config loaded successfully")
    return config
