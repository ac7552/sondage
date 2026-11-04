# For the Fellow's desktop app. Authenticated with a bearer token.
class Api::V1::BaseController < ActionController::API
  before_action :authenticate!
  rescue_from ActiveRecord::RecordNotFound, with: -> { render json: { error: "Not found" }, status: :not_found }
  rescue_from ActiveRecord::RecordInvalid, with: ->(e) { render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity }
  rescue_from ActionController::ParameterMissing, with: ->(e) { render json: { error: e.message }, status: :bad_request }

  private

  def authenticate!
    token = request.authorization.to_s[/\ABearer (.+)\z/, 1]
    @api_token = ApiToken.authenticate(token)
    return render(json: { error: "Please sign in again." }, status: :unauthorized) unless @api_token
    Current.api_user = @api_token.user
  end

  def current_user = Current.api_user

  def require_fellow!
    @fellow = current_user.fellow
    render json: { error: "This account has no Fellow profile." }, status: :forbidden unless current_user.fellow? && @fellow
  end
end
