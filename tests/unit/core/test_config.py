
import os
import pytest
import boto3
import yaml
from moto import mock_aws
from src.lambda_function.core.config import load_config_from_ssm, ConfigError, ParameterNotFoundError

# Define the mock parameter name and a sample valid config
MOCK_SSM_PARAMETER_NAME = "/test/app/config"
VALID_CONFIG_DICT = {
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
    """Yield a mock SSM client."""
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
