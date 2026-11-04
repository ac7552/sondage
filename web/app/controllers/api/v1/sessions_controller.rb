class Api::V1::SessionsController < Api::V1::BaseController
  skip_before_action :authenticate!, only: :create
  include ActionController::RateLimiting
  rate_limit to: 10, within: 3.minutes, only: :create, with: -> { render json: { error: "Too many attempts. Try again in a few minutes." }, status: :too_many_requests }

  def create
    user = User.find_for_authentication(email: params.require(:email))
    password = params.require(:password)
    # valid_for_authentication? counts failures towards Devise's lockout.
    unless user&.valid_for_authentication? { user.valid_password?(password) }
      locked = user&.access_locked?
      return render(json: { error: locked ? "This account is locked after too many tries. Check your email for an unlock link, or wait an hour." : "That email and password don't match." }, status: :unauthorized)
    end
    user.update_column(:failed_attempts, 0) if user.failed_attempts.to_i > 0
    token = ApiToken.issue!(user, client: params[:client].to_s.first(100))
    AuditEvent.record!("desktop.signed_in", actor: user, fellow: user.fellow, client: params[:client].to_s.first(100))
    render json: { token:, user: { id: user.id, name: user.name, email: user.email, role: user.role } }, status: :created
  end

  def destroy
    @api_token.destroy
    head :no_content
  end
end
