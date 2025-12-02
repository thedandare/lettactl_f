import { validateResourceType, validateRequired } from '../../src/lib/validators';

// Mock console.error and process.exit
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`Process exit called with code ${code}`);
});

describe('validators', () => {
  beforeEach(() => {
    mockConsoleError.mockClear();
    mockProcessExit.mockClear();
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  describe('validateResourceType', () => {
    it('should pass validation for valid resource type', () => {
      expect(() => {
        validateResourceType('agent', ['agent', 'block', 'folder']);
      }).not.toThrow();
      
      expect(mockConsoleError).not.toHaveBeenCalled();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should fail validation for invalid resource type', () => {
      expect(() => {
        validateResourceType('invalid', ['agent', 'block']);
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Only "agent/block" resource is currently supported'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle single valid type', () => {
      expect(() => {
        validateResourceType('agent', ['agent']);
      }).not.toThrow();
    });

    it('should format multiple types correctly in error message', () => {
      expect(() => {
        validateResourceType('wrong', ['agent', 'block', 'folder', 'tool']);
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Only "agent/block/folder/tool" resource is currently supported'
      );
    });
  });

  describe('validateRequired', () => {
    it('should pass validation when value is provided', () => {
      expect(() => {
        validateRequired('some-value', 'paramName');
      }).not.toThrow();
      
      expect(mockConsoleError).not.toHaveBeenCalled();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should fail validation when value is null', () => {
      expect(() => {
        validateRequired(null, 'agentName');
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: agentName is required');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should fail validation when value is undefined', () => {
      expect(() => {
        validateRequired(undefined, 'configFile');
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: configFile is required');
    });

    it('should fail validation when value is empty string', () => {
      expect(() => {
        validateRequired('', 'fileName');
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: fileName is required');
    });

    it('should show usage when provided', () => {
      expect(() => {
        validateRequired(null, 'agentName', 'lettactl get agent <name>');
      }).toThrow('Process exit called with code 1');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: agentName is required');
      expect(mockConsoleError).toHaveBeenCalledWith('Usage: lettactl get agent <name>');
    });

    it('should accept truthy values', () => {
      expect(() => validateRequired('value', 'param')).not.toThrow();
      expect(() => validateRequired(42, 'param')).not.toThrow();
      expect(() => validateRequired(true, 'param')).not.toThrow();
      expect(() => validateRequired([], 'param')).not.toThrow();
      expect(() => validateRequired({}, 'param')).not.toThrow();
    });

    it('should reject falsy values', () => {
      expect(() => validateRequired(false, 'param')).toThrow();
      expect(() => validateRequired(0, 'param')).toThrow();
      expect(() => validateRequired(NaN, 'param')).toThrow();
    });
  });
});