
import boto3
import yaml
from botocore.exceptions import ClientError

class ConfigError(Exception):
    """Base exception for configuration errors."""
    pass

class ParameterNotFoundError(ConfigError):
    """Raised when the SSM parameter is not found."""
    pass

def load_config_from_ssm(parameter_name: str) -> dict:
    """
    Loads configuration from an AWS SSM parameter.

    Args:
        parameter_name: The name of the SSM parameter.

    Returns:
        A dictionary containing the configuration.

    Raises:
        ParameterNotFoundError: If the parameter is not found.
        ConfigError: If the configuration is invalid.
    """
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
        return config
    except yaml.YAMLError as e:
        raise ConfigError(
            f"Failed to parse YAML configuration from parameter {parameter_name}: {str(e)}"
        ) from e
