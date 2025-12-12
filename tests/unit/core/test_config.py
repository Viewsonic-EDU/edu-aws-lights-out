
import os
import pytest
import boto3
import yaml
from moto import mock_aws
from unittest.mock import patch, MagicMock
from src.lambda_function.core.config import (
    load_config_from_ssm,
    ConfigError,
    ParameterNotFoundError,
    ConfigValidationError
)

# Define the mock parameter name and a sample valid config
MOCK_SSM_PARAMETER_NAME = "/test/app/config"
VALID_CONFIG_DICT = {
    'version': '1.0',
    'environment': 'test',
    'discovery': {
        'method': 'tags',
        'tag_filters': {
            'lights-out:managed': 'true'
        }
    },
    'settings': {
        'region': 'us-east-1',
        'schedule_tag': 'aws-lights-out-schedule'
    },
    'services': ['ec2', 'rds']
}
VALID_CONFIG_YAML = yaml.dump(VALID_CONFIG_DICT)

# Sample invalid YAML (unclosed bracket)
INVALID_CONFIG_YAML = """
settings:
  region: us-east-1
  schedule_tag: "aws-lights-out-schedule"
services: [ec2, rds
"""

@pytest.fixture(scope="function")
def aws_credentials():
    """Mocked AWS Credentials for moto."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"

@pytest.fixture(scope="function")
def ssm_client(aws_credentials):
    """Yield a mock SSM client and clear cache before each test."""
    # Clear LRU cache before each test to ensure isolation
    load_config_from_ssm.cache_clear()

    with mock_aws():
        yield boto3.client("ssm", region_name="us-east-1")

def test_load_config_from_ssm_success(ssm_client):
    """
    Tests successful loading and parsing of a valid YAML config from SSM.
    """
    # Arrange
    ssm_client.put_parameter(
        Name=MOCK_SSM_PARAMETER_NAME,
        Value=VALID_CONFIG_YAML,
        Type="String"
    )

    # Act
    config = load_config_from_ssm(MOCK_SSM_PARAMETER_NAME)

    # Assert
    assert config == VALID_CONFIG_DICT

def test_load_config_from_ssm_parameter_not_found(ssm_client):
    """
    Tests that ParameterNotFoundError is raised if the SSM parameter does not exist.
    """
    # Act & Assert
    with pytest.raises(ParameterNotFoundError) as excinfo:
        load_config_from_ssm("non-existent-parameter")
    
    assert "Could not find SSM parameter" in str(excinfo.value)

def test_load_config_from_ssm_invalid_yaml(ssm_client):
    """
    Tests that ConfigError is raised for invalid YAML content.
    """
    # Arrange
    ssm_client.put_parameter(
        Name=MOCK_SSM_PARAMETER_NAME,
        Value=INVALID_CONFIG_YAML,
        Type="String"
    )

    # Act & Assert
    with pytest.raises(ConfigError) as excinfo:
        load_config_from_ssm(MOCK_SSM_PARAMETER_NAME)

    assert "Failed to parse YAML configuration" in str(excinfo.value)

def test_load_config_from_ssm_missing_required_fields(ssm_client):
    """
    Tests that ConfigValidationError is raised when required fields are missing.
    """
    # Arrange - Config missing 'version' and 'discovery' fields
    incomplete_config = {
        'environment': 'test'
    }
    ssm_client.put_parameter(
        Name=MOCK_SSM_PARAMETER_NAME,
        Value=yaml.dump(incomplete_config),
        Type="String"
    )

    # Act & Assert
    with pytest.raises(ConfigValidationError) as excinfo:
        load_config_from_ssm(MOCK_SSM_PARAMETER_NAME)

    assert "Missing required field" in str(excinfo.value)

def test_load_config_from_ssm_with_all_required_fields(ssm_client):
    """
    Tests successful loading when all required fields are present.
    """
    # Arrange - Config with all required fields (use a different param name to avoid cache)
    param_name = "/test/complete/config"
    complete_config = {
        'version': '1.0',
        'environment': 'workshop',
        'region': 'ap-southeast-1',
        'discovery': {
            'method': 'tags',
            'tag_filters': {
                'lights-out:managed': 'true'
            }
        }
    }
    ssm_client.put_parameter(
        Name=param_name,
        Value=yaml.dump(complete_config),
        Type="String"
    )

    # Act
    config = load_config_from_ssm(param_name)

    # Assert
    assert config == complete_config
    assert 'version' in config
    assert 'environment' in config
    assert 'discovery' in config

def test_load_config_from_ssm_logs_info_messages(ssm_client):
    """
    Tests that the function logs appropriate info messages during execution.
    """
    # Arrange - Use a different param name to avoid cache
    param_name = "/test/logging/config"
    complete_config = {
        'version': '1.0',
        'environment': 'test',
        'discovery': {}
    }
    ssm_client.put_parameter(
        Name=param_name,
        Value=yaml.dump(complete_config),
        Type="String"
    )

    # Act & Assert
    with patch('src.lambda_function.core.config.logger') as mock_logger:
        config = load_config_from_ssm(param_name)

        # Verify logger.info was called
        assert mock_logger.info.call_count >= 2
        # Verify it logged the parameter name
        mock_logger.info.assert_any_call(
            f"Loading config from SSM: {param_name}"
        )
        # Verify it logged success
        mock_logger.info.assert_any_call("Config loaded successfully")

def test_load_config_from_ssm_caches_result(aws_credentials):
    """
    Tests that the function caches the result and doesn't call SSM multiple times
    for the same parameter name.

    Note: This test doesn't use ssm_client fixture to avoid auto cache clearing.
    """
    # Arrange - Use a unique param name for this test
    param_name = "/test/cache/config"
    complete_config = {
        'version': '1.0',
        'environment': 'test',
        'discovery': {}
    }

    # Manually clear cache before this specific test
    load_config_from_ssm.cache_clear()

    # Act - Call the function twice with the same parameter
    with patch('boto3.client') as mock_boto_client:
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.return_value = {
            'Parameter': {'Value': yaml.dump(complete_config)}
        }
        mock_boto_client.return_value = mock_ssm

        config1 = load_config_from_ssm(param_name)
        config2 = load_config_from_ssm(param_name)

        # Assert - SSM client should only be created once (cached)
        assert config1 == config2
        assert mock_boto_client.call_count == 1  # Only called once due to cache
        assert mock_ssm.get_parameter.call_count == 1  # Only called once
